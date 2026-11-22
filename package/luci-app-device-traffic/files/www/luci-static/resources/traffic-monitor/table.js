// Modified for Device Traffic from luci-app-nlbw-history; see NOTICE.
'use strict';
'require baseclass';

const KEYS=['host','ip','mac','rx','tx','total'];
const LABELS={Host:'host',Protocol:'host',IPv4:'ip',MAC:'mac',Download:'rx',Upload:'tx',Total:'total','24h Usage':'total'};
function valid(sort){return sort&&KEYS.includes(sort.key)&&['ascending','descending'].includes(sort.direction);}
function numeric(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function ipNumber(value){const parts=String(value).split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)?parts.reduce((n,p)=>n*256+Number(p),0):null;}

return baseclass.extend({
    loadSort:function(page){
        try{const sort=JSON.parse(window.localStorage.getItem('traffic-monitor.'+page+'.table-sort')||window.localStorage.getItem('nlbw-history-custom.'+page+'.table-sort'));if(valid(sort))return sort;}catch(e){}
        return {key:'total',direction:'descending'};
    },
    saveSort:function(page,sort){try{window.localStorage.setItem('traffic-monitor.'+page+'.table-sort',JSON.stringify(sort));}catch(e){}},
    nextSort:function(sort,key){return {key:key,direction:sort.key===key?(sort.direction==='ascending'?'descending':'ascending'):['rx','tx','total'].includes(key)?'descending':'ascending'};},
    sortRows:function(rows,sort,options){
        options=options||{};sort=valid(sort)?sort:{key:'total',direction:'descending'};
        function value(row){
            if(sort.key==='host')return row.name&&row.name!==row.mac&&row.name!=='-'?String(row.name):null;
            if(sort.key==='ip')return ipNumber(options.ipv4?options.ipv4(row):row.ip);
            if(sort.key==='mac')return /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(row.mac))?row.mac.toLowerCase():null;
            if(sort.key==='rx')return numeric(options.live?row.rx_now:row.rx);
            if(sort.key==='tx')return numeric(options.live?row.tx_now:row.tx);
            if(options.total)return options.total(row);
            return numeric(row.rx)+numeric(row.tx);
        }
        const direction=sort.direction==='ascending'?1:-1;
        return (rows||[]).map(row=>({row:row,value:value(row),id:String(row.mac||row.name||'').toLowerCase()})).sort((a,b)=>{
            if(a.value===null&&b.value!==null)return 1;
            if(a.value!==null&&b.value===null)return -1;
            let difference=0;
            if(a.value!==null&&b.value!==null){
                if(typeof a.value==='number')difference=a.value-b.value;
                else if(sort.key==='mac')difference=a.value<b.value?-1:a.value>b.value?1:0;
                else difference=a.value.localeCompare(b.value,undefined,{numeric:true,sensitivity:'base'});
            }
            return difference*direction||(a.id<b.id?-1:a.id>b.id?1:0);
        }).map(item=>item.row);
    },
    decorateHeader:function(cell,label,sort,onSort){
        const key=LABELS[label];if(!key)return;
        const active=sort.key===key;
        cell.classList.add('nbh-sortable');cell.tabIndex=0;
        cell.setAttribute('aria-label',label);cell.setAttribute('aria-sort',active?sort.direction:'none');
        cell.title=(cell.title?cell.title+'. ':'')+_('Click to sort');
        const change=()=>onSort(this.nextSort(sort,key));
        cell.addEventListener('click',change);
        cell.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();change();}});
    }
});
