// Modified for Device Traffic from luci-app-nlbw-history; see NOTICE.
'use strict';
'require baseclass';

// Everything the history page and the live page draw in common: the palette,
// the number formatting, and the stacked bar chart itself. Both pages have to
// look like one app, and a second copy of a 120 line SVG builder is how two
// charts quietly stop matching.
//
// The chart is built as an SVG string on purpose. LuCI's E() uses
// document.createElement, which cannot produce namespaced SVG nodes, so
// appending E('svg', ...) renders nothing at all. Do not "clean this up".

return baseclass.extend({
	PALETTE: [ '#3d6fb4', '#d98032', '#4e9e6a', '#c2504f', '#7a6bab',
	           '#3aa3a8', '#b4699b', '#8a7f6d' ],
	OTHER_COLOR: '#9aa3ac',

	// 'si' counts in thousands and prints MB, 'iec' counts in 1024s and MiB.
	units: 'si',
	// Clock and date order. 'auto' leaves both to the browser's locale.
	formats: { time: 'auto', date: 'auto' },
	chartType: 'bar',

	// Blocked site data and private windows make localStorage throw rather
	// than come back empty, so every access goes through these two.
	stored: function(key) {
		try {
            let value=window.localStorage.getItem(key);
            if(value===null&&key.startsWith('traffic-monitor.')){
                const suffix=key.slice('traffic-monitor.'.length);
                const legacy='nlbw-history-custom.'+suffix+(suffix==='live-rate-unit'?'-v24':'');
                value=window.localStorage.getItem(legacy);
                if(value!==null)window.localStorage.setItem(key,value);
            }
            return value;
        } catch (e) { return null; }
	},

	store: function(key, value) {
		try { window.localStorage.setItem(key, value); } catch (e) {}
	},

	loadUnits: function() {
		const u = this.stored('traffic-monitor.units');
		this.units = (u === 'si' || u === 'iec') ? u : 'si';
		return this.units;
	},

	saveUnits: function(v) {
		this.units = v;
		this.store('traffic-monitor.units', v);
	},

	loadFormats: function(uci) {
		let t, d, c;
		try {
			t = uci.get('traffic-monitor', 'main', 'time_format');
			d = uci.get('traffic-monitor', 'main', 'date_format');
			c = uci.get('traffic-monitor', 'main', 'chart_type');
		}
		catch (e) {}
		this.chartType = (c === 'line' || c === 'area') ? c : 'bar';
		this.formats = {
			time: (t === '12' || t === '24') ? t : 'auto',
			date: (d === 'dmy' || d === 'mdy') ? d : 'auto'
		};
	},

	colorAt: function(i, key) {
		return (key === 'other') ? this.OTHER_COLOR : this.PALETTE[i % this.PALETTE.length];
	},

	esc: function(s) {
		return String(s).replace(/[&<>"']/g, function(c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	},

	fmtBytes: function(n) {
		const iec = (this.units === 'iec');
		const base = iec ? 1024 : 1000;
		const u = iec ? [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ] : [ 'B', 'kB', 'MB', 'GB', 'TB' ];
		let i = 0;
		n = +n || 0;
		while (n >= base && i < u.length - 1) { n /= base; i++; }
		return (i === 0 || n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
	},

	fmtRate: function(bps) {
		if (!isFinite(bps) || bps <= 0) return '0';
		if (bps < 1000) return bps.toFixed(0) + ' bit/s';
		if (bps < 1e6) return (bps / 1e3).toFixed(bps < 1e5 ? 1 : 0) + ' kbit/s';
		if (bps < 1e9) return (bps / 1e6).toFixed(bps < 1e8 ? 1 : 0) + ' Mbit/s';
		return (bps / 1e9).toFixed(2) + ' Gbit/s';
	},

	// Bytes per second rather than bits. Follows the si/iec choice, so it
	// prints MB/s or MiB/s to match the byte totals beside it, where fmtRate
	// is always SI because a kbit is a thousand bits everywhere.
	fmtByteRate: function(bps) {
		if (!isFinite(bps) || bps <= 0) return '0';
		return this.fmtBytes(bps) + '/s';
	},

	// hourCycle rather than hour12:false, which renders midnight as 24:00 in
	// a few locales.
	clockOpts: function(opts) {
		if (this.formats.time === '12') return Object.assign({ hour12: true }, opts);
		if (this.formats.time === '24') return Object.assign({ hourCycle: 'h23' }, opts);
		return opts;
	},

	fmtDayMonth: function(d) {
		const dd = ('0' + d.getDate()).slice(-2);
		const mm = ('0' + (d.getMonth() + 1)).slice(-2);
		if (this.formats.date === 'dmy') return dd + '/' + mm;
		if (this.formats.date === 'mdy') return mm + '/' + dd;
		return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
	},

	fmtTime: function(ts, span) {
		const d = new Date(ts * 1000);
		if (span <= 48 * 3600)
			return d.toLocaleTimeString([], this.clockOpts({ hour: '2-digit', minute: '2-digit' }));
		return this.fmtDayMonth(d) + ' ' +
		       d.toLocaleTimeString([], this.clockOpts({ hour: '2-digit' }));
	},

	fmtClock: function(ts) {
		return new Date(ts * 1000).toLocaleTimeString([],
			this.clockOpts({ hour: '2-digit', minute: '2-digit', second: '2-digit' }));
	},

	niceMax: function(v) {
		if (!(v > 0)) return 1000;
		if (this.units === 'iec') {
			// round up to 1, 2, 4 ... times a power of 1024, so the quarter
			// marks stay whole numbers
			let u = 1;
			while (v / u >= 1024) u *= 1024;
			let f = 1;
			while (f < v / u) f *= 2;
			return f * u;
		}
		let e = 1;
		while (v / e >= 10) e *= 10;
		const f = v / e;
		return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
	},

	fmtSpan: function(sec) {
		if (sec < 60) return Math.round(sec) + ' s';
		if (sec < 3600) return Math.round(sec / 60) + ' min';
		if (sec % 3600 === 0 && sec <= 86400) return (sec / 3600) + ' h';
		return (sec / 3600).toFixed(1) + ' h';
	},

	// One stacked bar chart, as an SVG string.
	//
	//   n        number of bars
	//   keys     stacking order, bottom band first
	//   labels   one per key, for the tooltips
	//   colors   one per key
	//   value    (key, i) -> the number for that band in that bar
	//   fmtY     (v) -> the y axis label, and the tooltip's value
	//   xLabel   (i) -> one of the seven labels along the bottom, i in 0..6
	//   title    top left
	//   corner   top right, normally the width of one bar
	//   tip      (key, i, v) -> tooltip text, optional
    // Monotone cubic interpolation keeps every sample and introduces no new extrema.
    curvePath: function(points) {
        const n=points.length;
        if(!n)return '';
        const point=p=>p.x.toFixed(2)+' '+p.y.toFixed(2);
        let path='M'+point(points[0]);
        if(n===1)return path;
        const slopes=[],tangents=new Array(n).fill(0);
        for(let i=0;i<n-1;i++)slopes[i]=(points[i+1].y-points[i].y)/(points[i+1].x-points[i].x);
        tangents[0]=slopes[0];tangents[n-1]=slopes[n-2];
        for(let i=1;i<n-1;i++){
            const a=slopes[i-1],b=slopes[i];
            tangents[i]=a*b>0?2*a*b/(a+b):0;
        }
        for(let i=0;i<n-1;i++){
            const d=slopes[i];
            if(d===0){tangents[i]=0;tangents[i+1]=0;continue;}
            const a=tangents[i]/d,b=tangents[i+1]/d,length=Math.hypot(a,b);
            if(length>3){const scale=3/length;tangents[i]=scale*a*d;tangents[i+1]=scale*b*d;}
        }
        for(let i=0;i<n-1;i++){
            const p=points[i],q=points[i+1],handle=(q.x-p.x)*.45;
            const low=Math.min(p.y,q.y),high=Math.max(p.y,q.y),bound=v=>Math.max(low,Math.min(high,v));
            path+=' C'+point({x:p.x+handle,y:bound(p.y+tangents[i]*handle)})+' '+
                point({x:q.x-handle,y:bound(q.y-tangents[i+1]*handle)})+' '+point(q);
        }
        return path;
    },

	svg: function(o) {
		const W = Math.max(280,Math.round(o.width||1000)), H = o.height||270, R = 14, T = 30, B = 30;
		const n = o.n;

		const area = this.chartType === 'area';
        const line = this.chartType === 'line' || area;
        const value = function(k,i){const v=Number(o.value(k,i));return Number.isFinite(v)&&v>0?v:0;};
        let peak = 0;
		for (let i = 0; i < n; i++) {
			let sum = 0;
            for (let k of o.keys) {
                const v=value(k,i);sum+=v;
                if(line&&v>peak)peak=v;
            }
            if (!line && sum > peak) peak = sum;
		}
		const max = this.niceMax(peak);
        const yLabels=Array.from({length:5},(_,i)=>String(o.fmtY(max*i/4)));
        // Numeric-only axes need less space; retain room for small decimal rates.
        const L=o.compactAxis?Math.max(40,Math.min(90,Math.max(...yLabels.map(s=>s.length))*7+12)):74;
        const pw=W-L-R,ph=H-T-B;

		let s = '<svg data-chart-type="' + (area ? 'area' : (line ? 'line' : 'bar')) + '" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;display:block">';
		s += '<text x="' + (W / 2) + '" y="13" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor" ' +
		     'fill-opacity="0.75">' + this.esc(o.title) + '</text>';
		if (o.corner)
			s += '<text x="' + (W - R) + '" y="13" text-anchor="end" font-size="13" ' +
			     'fill="currentColor" fill-opacity="0.6">' + this.esc(o.corner) + '</text>';

		for (let i = 0; i <= 4; i++) {
			const y = T + ph - ph * i / 4;
			s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' +
			     y.toFixed(1) + '" stroke="currentColor" stroke-opacity="0.12"/>';
			s += '<text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) +
			     '" text-anchor="end" font-size="13" fill="currentColor" fill-opacity="0.7">' +
			     this.esc(yLabels[i]) + '</text>';
		}

		const bw = pw / Math.max(n, 1);
        if (line) {
            let areaLayer='',lineLayer='';
            for(let ki=0;ki<o.keys.length;ki++){
                const k=o.keys[ki],points=[];
                for(let i=0;i<n;i++){
                    const v=value(k,i),x=L+(i+.5)*bw,y=T+ph-ph*v/max;
                    points.push({x:x,y:y});
                }
                const curve=this.curvePath(points);
                if(area&&points.length){
                    const first=points[0],last=points[points.length-1],baseline=(T+ph).toFixed(2);
                    areaLayer+='<path class="nbh-area" data-series="'+this.esc(k)+'" d="'+curve+' L'+last.x.toFixed(2)+' '+baseline+' L'+first.x.toFixed(2)+' '+baseline+' Z" fill="'+this.esc(o.colors[ki])+'" fill-opacity="0.1" stroke="none" pointer-events="none"/>';
                }
                if(points.length)lineLayer+='<path class="nbh-line" data-series="'+this.esc(k)+'" d="'+curve+'" fill="none" stroke="'+this.esc(o.colors[ki])+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" pointer-events="none"/>';
                for(let i=0;i<n;i++){
                    const v=value(k,i);
                    if(v<=0)continue;
                    const x=L+(i+.5)*bw,y=T+ph-ph*v/max;
                    if(n===1)lineLayer+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="2" fill="'+this.esc(o.colors[ki])+'"/>';
                    if(o.tip)lineLayer+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="5" fill="transparent" pointer-events="all"><title>'+this.esc(o.tip(k,i,v))+'</title></circle>';
                }
            }
            s+=areaLayer+lineLayer;
        } else {
		for (let i = 0; i < n; i++) {
			let acc = 0;
			for (let ki = 0; ki < o.keys.length; ki++) {
				const v = value(o.keys[ki], i);
				if (v <= 0) continue;
				const h = ph * v / max;
				const x = L + i * bw;
				s += '<rect x="' + x.toFixed(2) + '" y="' + (T + ph - acc - h).toFixed(2) +
				     '" width="' + Math.max(bw - 0.6, 0.6).toFixed(2) + '" height="' + h.toFixed(2) +
				     '" fill="' + o.colors[ki] + '">';
				if (o.tip)
					s += '<title>' + this.esc(o.tip(o.keys[ki], i, v)) + '</title>';
				s += '</rect>';
				acc += h;
			}
		}

        }

		const ticks=W<600?3:6;
		for (let i = 0; i <= ticks; i++) {
			const x = L + pw * i / ticks;
			const anchor = i === 0 ? 'start' : (i === ticks ? 'end' : 'middle');
			s += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor +
			     '" font-size="13" fill="currentColor" fill-opacity="0.7">' +
			     this.esc(o.xLabel(i*6/ticks)) + '</text>';
		}

		s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ph) + '" y2="' + (T + ph) +
		     '" stroke="currentColor" stroke-opacity="0.3"/></svg>';
		return s;
	},

	// The row of coloured labels under the charts. onToggle makes an entry
	// clickable; "other" is an aggregate with no stable key behind it, so it
	// is the one band that can never be hidden on its own.
	legend: function(keys, labels, colors, onToggle) {
		const node = E('div', {
			style: 'display:flex;flex-wrap:wrap;gap:6px 18px;padding:8px 0 2px;font-size:inherit'
		});
		keys.forEach(function(k, i) {
			const clickable = onToggle && (k !== 'other');
			const item = E('span', {
				style: 'display:flex;align-items:center;gap:6px' + (clickable ? ';cursor:pointer' : ''),
				title: clickable ? _('Hide from the chart') : ''
			}, [
				E('i', { style: 'width:11px;height:11px;border-radius:2px;background:' + colors[i] }),
				labels[i]
			]);
			if (clickable)
				item.addEventListener('click', function() { onToggle(k); });
			node.appendChild(item);
		});
		return node;
	}
});
