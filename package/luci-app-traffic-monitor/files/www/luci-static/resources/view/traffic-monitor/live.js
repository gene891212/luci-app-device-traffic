// Modified for Traffic Monitor from luci-app-nlbw-history; see NOTICE.
'use strict';
'require view';
'require rpc';
'require poll';
'require traffic-monitor.chart as chart';
'require traffic-monitor.table as trafficTable';
'require traffic-monitor.usage as usage';
// Opt-in diagnostics record timings only, never RPC parameters or data.
const profiling=new URLSearchParams(location.search).has('traffic_profile');
function profile(stage){if(profiling)console.debug('[traffic-profile] '+JSON.stringify({stage,ms:Math.round(performance.now()),visibility:document.visibilityState}));}
profile('module-ready');
const callConfig=rpc.declare({object:'uci',method:'get',params:['config'],expect:{values:{}},nobatch:true});
const callHostHints=rpc.declare({object:'luci-rpc',method:'getHostHints',expect:{'':{}},nobatch:true});
const callUsage=rpc.declare({object:'luci_traffic_monitor',method:'series',params:['hours','buckets','mac','protocol','end','hide'],nobatch:true});
let displayConfig={};
const configReader={get:function(config,section,option){return displayConfig[section]&&displayConfig[section][option];}};
function chartPanelWidth(node){
 return Math.max(280,Math.round(node.clientWidth||280));
}
function observeChartWidth(node,paint){
 let width=0,frame,initial;
 function update(){
   const next=Math.round(node.clientWidth);
   if(!node.isConnected||next<=0||next===width)return;
   width=next;paint();
 }
 function schedule(){
   // The first paint must not wait behind LuCI/browser frame scheduling.
   // A task runs after mounting, so width is real before any SVG is built.
   if(width===0){clearTimeout(initial);initial=setTimeout(update,0);return;}
   cancelAnimationFrame(frame);frame=requestAnimationFrame(update);
 }
 // Run after mounting, including on browsers without ResizeObserver.
 schedule();
 if(typeof ResizeObserver!=='undefined'){
   const observer=new ResizeObserver(schedule);observer.observe(node);
 }
}




let hostHints=null,hostHintsAt=0,hostHintsPending=null;
function refreshHostHints(){
  if(hostHints&&Date.now()-hostHintsAt<30000)return Promise.resolve(false);
  if(hostHintsPending)return hostHintsPending;
  hostHintsPending=callHostHints().then(function(h){hostHints=h;hostHintsAt=Date.now();return true;}).catch(function(){return false;}).finally(function(){hostHintsPending=null;});
  return hostHintsPending;
}
function currentIPv4(row){
 const key=String(row.mac),parts=key.split('.');
 if(parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255))return key;
 const hint=hostHints&&(hostHints[key.toUpperCase()]||hostHints[key.toLowerCase()]);
 return hint?(L.toArray(hint.ipaddrs||hint.ipv4)[0]||'-'):'-';
}
function macAddress(row){return /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(row.mac))?row.mac:'-';}
const callLive = rpc.declare({
	object: 'luci_traffic_monitor',
	method: 'live',
	nobatch: true,
	// Both, and in this order: rpc.declare maps positional arguments against
	// this list by index, so a name missing here is an argument silently
	// dropped on the floor rather than an error.
	params: [ 'device', 'protocol' ]
});

const PALETTE = chart.PALETTE;
const OTHER_COLOR = chart.OTHER_COLOR;
let tableSort={key:'total',direction:'descending'};

let state = { data: null, paused: false, mac: '', proto: '' };
const usageCache=new Map();
let firstChartPainted=false;
function usageKey(){return JSON.stringify([state.mac,state.proto]);}
function currentUsage(){return usageCache.get(usageKey());}

// Devices taken out of the stack so the rest can use the full height. Kept
// apart from the history page's own set: the two pages answer different
// questions, and something hidden because it dwarfs a month of history is not
// necessarily something you want gone from a live chart.
// Bytes per second by default. A versioned preference applies the new default
// once, then remembers any subsequent unit choice without a data refetch.
let RATEUNIT = 'byte';

function loadRateUnit() {
	const v = chart.stored('traffic-monitor.live-rate-unit');
	RATEUNIT = (v === 'bit') ? 'bit' : 'byte';
}

function saveRateUnit(v) {
	RATEUNIT = (v === 'bit') ? 'bit' : 'byte';
	chart.store('traffic-monitor.live-rate-unit', RATEUNIT);
}

// Takes bytes per second, which is what the ring holds.
function fmtR(bps) {
	return (RATEUNIT === 'byte') ? chart.fmtByteRate(bps) : chart.fmtRate(bps * 8);
}

function rateAxisUnit(){return RATEUNIT==='byte'?(chart.units==='iec'?'MiB/s':'MB/s'):'Mbit/s';}
function fmtAxisRate(bytesPerSecond){
 const scaled=RATEUNIT==='byte'?bytesPerSecond/(chart.units==='iec'?1048576:1e6):bytesPerSecond*8/1e6;
 return Number.isFinite(scaled)&&scaled>0?Number(scaled.toPrecision(3)).toString():'0';
}

let hidden = { devices: {}, protocols: {} };

function dimOf(data) {
	return (data && data.mode === 'protocols') ? 'protocols' : 'devices';
}

function loadHidden() {
	hidden = { devices: {}, protocols: {} };
	const raw = chart.stored('traffic-monitor.live-hidden');
	if (!raw) return;
	try {
		const o = JSON.parse(raw) || {};
		for (let k of o.devices || []) hidden.devices[k] = true;
		for (let k of o.protocols || []) hidden.protocols[k] = true;
	}
	catch (e) {}
}

function saveHidden() {
	chart.store('traffic-monitor.live-hidden', JSON.stringify({
		devices: Object.keys(hidden.devices),
		protocols: Object.keys(hidden.protocols)
	}));
}

// The table follows whatever is stacked, as it does on the history page.
function stackRows(data) {
	return ((dimOf(data) === 'protocols') ? data.protocols : data.devices) || [];
}

// mac -> name, straight from the backend, which resolves them exactly as
// traffic-monitor-query does. Doing it here client side instead would let the two
// pages disagree about what a device is called.
let NAMES = {};

function loadNames(data) {
	NAMES = {};
	for (let d of (data && data.devices) || [])
		if (d.name && d.name !== d.mac) NAMES[d.mac] = d.name;
}

// Protocols are already named by the backend, devices are keyed by MAC.
function keyLabel(key) {
	if (key === 'other') return _('Other');
	return NAMES[key] || key;
}

function stackedBy(data) {
	return (data && data.mode === 'protocols') ? _('by protocol') : _('by device');
}

// Bars hold bytes, the axis holds a rate: this page answers "how fast right
// now", where bytes per three seconds is not a number anyone reads. The bar
// width is stated in the corner the same way the history page states it.
//
// The axis is the whole configured window ending now, always, not just the
// samples collected so far. Drawn the other way the first bars are enormous
// and shrink with every poll until the window fills, which reads as the
// traffic changing when only the scale is. Samples land in the slot their
// timestamp falls in and the rest stay empty, so bars keep their width and
// scroll leftwards out of the window.
function slotsOf(data) {
	const iv = data.interval || 1;
	const win = data.window || iv * 60;
	// Capped for the same reason the history query caps its buckets: past a
	// few hundred the rectangles cost more than the detail is worth.
	const n = Math.max(2, Math.min(400, Math.round(win / iv)));
	const times = data.times || [];
	const now = data.now || times[times.length - 1] || 0;
	const slot = win / n;
	// Anchored to the clock, not to the moment this reply was built. Anchored
	// to now, the grid moves a fraction of a bar on every poll and every
	// sample rebuckets, so bars deep in the past change for no reason and two
	// browsers polling a moment apart draw different charts from the same
	// data. Snapped to absolute time the boundaries are the same everywhere,
	// the grid only ever advances a whole bar, and a bar that has passed
	// keeps its value.
	const end = (Math.floor(now / slot) + 1) * slot;
	return { n: n, win: win, slot: slot, from: end - win, end: end };
}

// Conntrack counters for an offloaded connection do not move smoothly: the
// kernel folds the hardware counters in about every three seconds, per flow
// and on each flow's own phase. Sampling a stepped signal at roughly the step
// period aliases, so a naive reading gives an empty bar followed by a double
// one, over and over.
//
// There is nothing to synchronise to. nf_ct_acct_add() only does two atomic
// adds, there is no conntrack event for a counter update, and each flow is
// phased independently anyway.
//
// So spread instead: a delta is known to have accumulated between this reading
// and the previous non-zero one FOR THAT KEY, and uniformly across that span
// is the best estimate available. Totals are preserved exactly, empty bars
// stop appearing, and the double bars go with them. The cost is that a genuine
// burst is smeared back over the gap before it, which is honest, because below
// about three seconds there is no finer truth to report.
//
// Bounded, though. An active flow gets a writeback every few seconds, so a key
// that reported nothing for a long stretch was genuinely idle and has only
// just resumed. Spreading that resumption across the whole idle period would
// paint traffic over minutes that were actually quiet, so the span is capped
// and anything older is left where it is: recent.
function spread(dst, sl, t0, t1, v) {
	const total = t1 - t0;
	if (!(total > 0)) return;
	const lo = Math.max(0, Math.floor((t0 - sl.from) / sl.slot));
	const hi = Math.min(sl.n - 1, Math.floor((t1 - sl.from) / sl.slot));
	for (let i = lo; i <= hi; i++) {
		// slot i covers [s0, s1)
		const s0 = sl.from + i * sl.slot, s1 = s0 + sl.slot;
		const a = Math.max(t0, s0), b = Math.min(t1, s1);
		if (b > a) dst[i] += v * (b - a) / total;
	}
}

function ratesOf(data, field, sl) {
	const times = data.times || [];
	const keys = Object.keys(data.series || {});
	const iv = data.interval || 1;
	// Wide enough to swallow the three second writeback and its aliasing,
	// narrow enough that a quiet minute stays quiet.
	const cap = Math.max(3 * iv, 10);
	const out = {};

	for (let k of keys) {
		out[k] = [];
		for (let i = 0; i < sl.n; i++) out[k][i] = 0;
	}

	for (let k of keys) {
		const arr = (data.series[k] && data.series[k][field]) || [];
		// Where this key last reported, so the first reading of a key is
		// charged to one interval rather than to the whole window.
		let prev = (times.length ? times[0] - iv : 0);
		for (let i = 0; i < times.length; i++) {
			const v = arr[i] || 0;
			if (v <= 0) continue;
			let t0 = prev;
			const t1 = times[i];
			prev = t1;
			if (!(t1 > t0)) t0 = t1 - iv;
			if (t1 - t0 > cap) t0 = t1 - cap;
			spread(out[k], sl, t0, t1, v);
		}
	}

	for (let k of keys)
		for (let i = 0; i < sl.n; i++) out[k][i] = out[k][i] / sl.slot;

	return out;
}

function renderCharts(node, data, onToggle) {
	// Reserve space while detached; build the SVG once at its mounted width.
	if(!node.isConnected||node.clientWidth<=0){node.style.minHeight='620px';node.style.visibility='hidden';return;}
	node.style.minHeight='';node.style.visibility='';
	const times = data.times || [];
	const dim = dimOf(data);
	const keys = Object.keys(data.series || {}).filter(function(k) { return !hidden[dim][k]; });

	if (!times.length || !keys.length) {
		node.innerHTML = '';
		node.appendChild(E('p', {}, !times.length
			? _('Waiting for the first samples. The sampler starts with this page.')
			: _('Everything is hidden. Tick a row in the table below to bring it back.')));
		return;
	}

	const rank = {};
	if (data.mode !== 'protocols')
		(data.devices || []).forEach(function(d, i) { rank[d.mac] = i; });
	keys.sort(function(a, b) {
		if (a === 'other') return 1;
		if (b === 'other') return -1;
		return (rank[a] === undefined ? 1e9 : rank[a]) - (rank[b] === undefined ? 1e9 : rank[b]);
	});

	const colors = keys.map(function(k, i) { return chart.colorAt(i, k); });
	const labels = keys.map(keyLabel);
	const corner = _('per') + ' ' + chart.fmtSpan(data.interval || 1);

	const sl = slotsOf(data);

	function one(field, title) {
		const rate = ratesOf(data, field, sl);
		return chart.svg({
			width: chartPanelWidth(node), height: 300, compactAxis: true,
			n: sl.n,
			keys: keys,
			labels: labels,
			colors: colors,
			value: function(k, i) { return (rate[k] && rate[k][i]) || 0; },
			fmtY: function(v) { return fmtAxisRate(v); },
			xLabel: function(i) { return chart.fmtClock(sl.from + sl.win * i / 6); },
			title: title,
			corner: corner,
			tip: function(k, i, v) {
				const ki = keys.indexOf(k);
				return chart.fmtClock(sl.from + i * sl.slot) + '  ' +
				       labels[ki] + '  ' + fmtR(v);
			}
		});
	}

	const by = stackedBy(data)+' ('+rateAxisUnit()+')';
	node.innerHTML = '<div class="nbh-chart-grid"><div class="nbh-chart-panel">'+one('rx', _('Download') + ' ' + by)+'</div><div class="nbh-chart-panel">'+one('tx', _('Upload') + ' ' + by)+'</div></div>';
	node.appendChild(chart.legend(keys, labels, colors, onToggle));
	if(!firstChartPainted){firstChartPainted=true;profile('chart-ready');}
}

function renderTable(node, data, onPick, onToggle, onSort) {
	const previousWrap=node.querySelector('.nbh-table-wrap');
	const scrollLeft=previousWrap?previousWrap.scrollLeft:0;
	node.innerHTML = '';

	const dim = dimOf(data);
	const proto = (dim === 'protocols');
	const sort=proto&&(tableSort.key==='ip'||tableSort.key==='mac')?{key:'total',direction:'descending'}:tableSort;
	const rows=trafficTable.sortRows(stackRows(data),sort,{live:true,ipv4:currentIPv4,total:function(row){return usage.total(currentUsage(),row,proto);}});
	if (!rows.length)
		return;

	const span = data.last_span || data.interval || 1;
	const out = [ E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, proto ? _('Protocol') : _('Host')),
		proto ? '' : E('th', { 'class': 'th', title: 'Current IPv4 address known to the router' }, _('IPv4')),
		proto ? '' : E('th', { 'class': 'th' }, _('MAC')),
		E('th', { 'class': 'th', style: 'text-align:right' }, _('Download')),
		E('th', { 'class': 'th', style: 'text-align:right' }, _('Upload')),
		E('th', { 'class': 'th', style: 'text-align:right',title:'Download + upload recorded over the last 24 hours; refreshed once per minute' }, _('24h Usage')),
	]) ];

	for (let r of rows) {
		const key = proto ? r.name : r.mac;
		const total = usage.total(currentUsage(),r,proto);
		const off = !!hidden[dim][key];
		// Set as a property rather than an attribute: LuCI's E() would put a
		// literal checked="false" on the node, which still checks the box.
		const box = E('input', {
			type: 'checkbox',
			title: off ? _('Show this in the chart') : _('Hide this from the chart'),
			change: function() { onToggle(key); }
		});
		box.checked = !off;
		out.push(E('tr', Object.assign({ 'class': 'tr' }, off ? { style: 'opacity:0.55' } : {}), [
			E('td', { 'class': 'td' }, E('div', { 'class':'nbh-host-content' }, [
                box,
                E('a', {
                    href:'#',
                    title:proto ? _('Show only this protocol') : _('Show only this device'),
                    click:function(ev){ev.preventDefault();onPick(key);}
                }, proto ? r.name : ((r.name && r.name !== r.mac) ? r.name : '-'))
            ])),
            proto ? '' : E('td', { 'class':'td' }, currentIPv4(r)),
            proto ? '' : E('td', { 'class':'td' }, macAddress(r)),
			E('td', { 'class': 'td', style: 'text-align:right' }, fmtR(r.rx_now / span)),
			E('td', { 'class': 'td', style: 'text-align:right' }, fmtR(r.tx_now / span)),
			E('td', { 'class': 'td', style: 'text-align:right',title:usage.description(currentUsage(),r,proto) }, total===null?'—':chart.fmtBytes(total)),
		]));
	}

	const headings=Array.from(out[0].children);
 for(const row of out){
   for(let i=0;i<row.children.length;i++){
     const cell=row.children[i],label=headings[i].textContent;
     cell.setAttribute('data-title',label);
     if(row===out[0])cell.setAttribute('scope','col');
     if(i===0)cell.classList.add('nbh-name');
     if(label==='IPv4')cell.classList.add('nbh-ip');
     if(label==='MAC')cell.classList.add('nbh-mac');
     if(label==='Download'||label==='Upload'||label==='24h Usage')cell.classList.add('nbh-number');
   }
 }
 const header=out.shift();
 for(const cell of header.children)trafficTable.decorateHeader(cell,cell.textContent,sort,onSort);
 node.appendChild(E('div',{'class':'nbh-table-wrap'},[
   E('table',{'class':'table nbh-device-table nbh-live-table'+(proto?' nbh-live-protocols':''),'aria-label':proto?'Protocol traffic':'Device traffic'},[
     E('thead',{'class':'thead'},header),E('tbody',{'class':'tbody'},out)
   ])
 ]));
 const wrap=node.querySelector('.nbh-table-wrap');if(wrap)wrap.scrollLeft=scrollLeft;
}

return view.extend({
	load: function() {
		loadHidden();
		loadRateUnit();
		profile('load-start');
		return Promise.all([
			callConfig('traffic-monitor').then(function(c){displayConfig=c;profile('config-ready');}).catch(function(){displayConfig={};}),
			callLive('', '').then(function(d){profile('live-ready');return d;}).catch(function(e) { return { error: '' + e }; }),
			refreshHostHints().then(function(){profile('hints-ready');})
		]);
	},

	render: function(res) {
		profile('render-start');
		state.data = res[1];
		chart.loadUnits();
		chart.loadFormats(configReader);
		loadNames(state.data);

		const chartNode = E('div', { 'class': 'nbh-charts' });
		observeChartWidth(chartNode,function(){if(state.data&&!state.data.error)renderCharts(chartNode,state.data,toggleHidden);});
		const tableNode = E('div', {});
		const hiddenNode = E('div', { 'class':'nbh-hidden' });
		const statusNode = E('div', { 'class':'nbh-status' });
		const warnNode = E('div', { 'class': 'alert-message warning', style: 'display:none' });
		// Same shape as the firewall live page: first in the row, and coloured
		// by what it will do, action while running and negative while paused.
		const pauseBtn = E('button', { 'class': 'cbi-button cbi-button-action',
			style: 'margin-right:16px' }, _('Pause'));
		const deviceSel = E('select', { 'class': 'cbi-input-select', style: 'min-width:240px' });
		const protoSel = E('select', { 'class': 'cbi-input-select', style: 'min-width:140px' });
		const unitsSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option', Object.assign({ value: 'bit' },
				RATEUNIT === 'bit' ? { selected: 'selected' } : {}), 'Mbit/s'),
			E('option', Object.assign({ value: 'byte' },
				RATEUNIT === 'byte' ? { selected: 'selected' } : {}), chart.units==='iec'?'MiB/s':'MB/s')
		]);

		function field(label, control) {
			const id='nbh-filter-'+label.toLowerCase();
			control.setAttribute('id',id);
			return E('span', { 'class':'nbh-field' },
				[ E('label', { 'for':id }, label), control ]);
		}

		// A filter is kept selectable even once its traffic has stopped, or it
		// would drop itself the moment the device or protocol went quiet.
		function fillSelect(sel, current, allLabel, items, valueOf, labelOf) {
			sel.innerHTML = '';
			sel.appendChild(E('option', { value: '' }, allLabel));
			let found = false;
			for (let it of items || []) {
				const v = valueOf(it);
				if (v === current) found = true;
				sel.appendChild(E('option', { value: v }, labelOf(it)));
			}
			if (current && !found)
				sel.appendChild(E('option', { value: current }, current));
			sel.value = current;
		}

		function fillFilters(data) {
			fillSelect(deviceSel, state.mac, _('All devices'), data.devices,
				function(d) { return d.mac; },
				function(d) { return (d.name && d.name !== d.mac) ? (d.name + ' (' + d.mac + ')') : d.mac; });
			fillSelect(protoSel, state.proto, _('All protocols'), data.protocols,
				function(p) { return p.name; },
				function(p) { return p.name; });
		}

		function toggleHidden(key) {
			const dim = dimOf(state.data);
			if (hidden[dim][key]) delete hidden[dim][key];
			else hidden[dim][key] = true;
			saveHidden();
			paint();
		}

		function renderHidden() {
			const dim = dimOf(state.data);
			const keys = Object.keys(hidden[dim]);
			hiddenNode.innerHTML = '';
			if (!keys.length)
				return;
			hiddenNode.appendChild(E('span', { style: 'opacity:0.75' },
				(dim === 'protocols' ? _('Hidden protocols') : _('Hidden devices')) +
				': ' + keys.map(keyLabel).join(', ') + ' — '));
			hiddenNode.appendChild(E('a', {
				href: '#',
				click: function(ev) {
					ev.preventDefault();
					hidden[dimOf(state.data)] = {};
					saveHidden();
					paint();
				}
			}, _('show all')));
		}

		function paintPause() {
			pauseBtn.textContent = state.paused ? _('Resume') : _('Pause');
			pauseBtn.className = 'cbi-button' +
				(state.paused ? ' cbi-button-negative' : ' cbi-button-action');
		}

		function paint() {
			paintPause();
			const d = state.data;
			if (!d || d.error) {
				warnNode.style.display = '';
				warnNode.textContent = (d && d.error) || _('No data returned.');
				chartNode.innerHTML = '';
				tableNode.innerHTML = '';
				hiddenNode.innerHTML = '';
				statusNode.textContent = '';
				return;
			}

			if (d.accounting === false) {
				warnNode.style.display = '';
				warnNode.textContent = _('conntrack has no byte counters, so there is nothing to chart. Enable them with') +
					': sysctl -w net.netfilter.nf_conntrack_acct=1';
			}
			else {
				warnNode.style.display = 'none';
			}

			fillFilters(d);
			renderCharts(chartNode, d, toggleHidden);
			renderTable(tableNode, d, function(key) {
				if (dimOf(d) === 'protocols') state.proto = key;
				else state.mac = key;
				refresh();
			}, toggleHidden,function(next){tableSort=next;trafficTable.saveSort('live',next);paint();});
			renderHidden();

			const bits = [
				_('Sampler') + ': ' + (d.sampler || _('unknown')),
				_('source') + ': ' + (d.source || '?'),
				_('resolution') + ': ' + chart.fmtSpan(d.interval || 1) + ' ' + _('per bar'),
				_('window') + ': ' + chart.fmtSpan(d.window || 0)
			];
			if (state.paused) bits.push(_('paused'));
			statusNode.textContent = bits.join(' — ');
		}

		function paintTable(){
			if(!state.data||state.data.error)return;
			if(state.data.device!==state.mac||state.data.protocol!==state.proto)return;
			renderTable(tableNode,state.data,function(key){
				if(dimOf(state.data)==='protocols')state.proto=key;else state.mac=key;
				refresh();
			},toggleHidden,function(next){tableSort=next;trafficTable.saveSort('live',next);paintTable();});
		}
		function refreshUsage(){
			const key=usageKey(),mac=state.mac,proto=state.proto;
			let entry=usageCache.get(key);
			if(entry&&(entry.pending||Date.now()-entry.at<60000))return;
			if(!entry){entry={at:0,data:null,pending:false,error:null};usageCache.set(key,entry);}
			// The history backend cannot represent raw live port labels such as udp:12345.
			// Do not silently strip the colon and display a different protocol's usage.
			if(!/^[0-9A-Za-z._+ -]*$/.test(proto)){
				entry.error='This live protocol has no matching recorded history.';entry.at=Date.now();paintTable();return;
			}
			entry.pending=true;
			callUsage(24,24,mac,proto,0,'').then(function(d){
				if(!d||d.error)throw new Error(d&&d.error||'No history returned');
				entry.data=d;entry.error=null;entry.at=Date.now();profile('usage-ready');
			}).catch(function(e){entry.error=String(e);entry.at=Date.now()-50000;}).finally(function(){
				entry.pending=false;
				if(usageKey()===key)paintTable();
				if(usageCache.size>16){for(const oldKey of usageCache.keys()){if(oldKey!==key&&!usageCache.get(oldKey).pending){usageCache.delete(oldKey);break;}}}
			});
		}
		let liveSequence=0;
		function refresh() {
			if (state.paused) return Promise.resolve();
			const sequence=++liveSequence;
			// Hints and historical usage never hold up the per-second live request.
			refreshHostHints().then(function(changed){if(changed)paintTable();});
			refreshUsage();
			return callLive(state.mac,state.proto).then(function(d) {
				if(sequence!==liveSequence||state.paused)return;
				state.data = d;loadNames(d);paint();profile('live-update');
			}).catch(function(e) {
				if(sequence!==liveSequence||state.paused)return;
				state.data = { error: '' + e };paint();
			});
		}

		// Repaint at once from what is already loaded so the chart reacts to
		// the click, then refetch: the backend restacks by protocol.
		deviceSel.addEventListener('change', function() {
			state.mac = deviceSel.value;
			refresh();
		});
		protoSel.addEventListener('change', function() {
			state.proto = protoSel.value;
			refresh();
		});
		// Display only, so nothing has to be fetched again.
		unitsSel.addEventListener('change', function() {
			saveRateUnit(unitsSel.value);
			paint();
		});

		pauseBtn.addEventListener('click', function() {
			state.paused = !state.paused;
			paint();
		});

		// The poll interval follows the bar width, and each poll doubles as
		// the signal that keeps the on demand sampler alive: stop polling and
		// it shuts itself down.
		let iv = parseInt(configReader.get('traffic-monitor', 'main', 'live_interval'), 10);
		if (!(iv >= 1 && iv <= 60)) iv = 3;
		poll.add(refresh, iv);

		const body = E('div', { 'class': 'cbi-map nbh-layout' }, [
			E('link', {rel:'stylesheet',href:L.resource('traffic-monitor/layout.css')}),
			E('h2', {}, _('Live Bandwidth')),
			E('div', { 'class': 'cbi-section nbh-toolbar' }, [
				E('div', { 'class':'nbh-controls' },
					[ pauseBtn, field(_('Device'), deviceSel), field(_('Protocol'), protoSel),
					  field(_('Units'), unitsSel) ]),
				E('p', { 'class': 'cbi-section-descr', style: 'margin:8px 0 0' },
					_('Read straight from conntrack rather than nlbwmon, and nothing is stored. ' +
					  'Sampling runs only while this page is open. Pick a device to see which ' +
					  'protocols it is using, or a protocol to see who is using it. Untick a row ' +
					  'in the table, or click a legend entry, to drop it from the chart so the ' +
					  'rest can use the full height.')),
				hiddenNode,
				statusNode,
				warnNode
			]),
			E('div', { 'class': 'cbi-section nbh-chart-section' }, [ chartNode ]),
			E('div', { 'class': 'cbi-section' }, [ tableNode ])
		]);

		paint();profile('render-done');
		// Start history after returning the live view; it is not on the first-paint path.
		setTimeout(refreshUsage,0);
		if(profiling)requestAnimationFrame(function(){profile('mounted');console.debug('[traffic-resources] '+JSON.stringify(performance.getEntriesByType('resource').map(function(x){return {file:x.name.split('?')[0].split('/').pop(),start:Math.round(x.startTime),ms:Math.round(x.duration)};})));});
		return body;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
