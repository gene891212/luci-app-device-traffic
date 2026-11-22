// Modified for Device Traffic from luci-app-nlbw-history; see NOTICE.
'use strict';
'require baseclass';

return baseclass.extend({
    total:function(entry,row,protocols){
        if(!entry||!entry.data||entry.error||!entry.data.last_sample)return null;
        const key=protocols?row.name:String(row.mac).toLowerCase();
        if(protocols&&String(key).includes(':'))return null;
        if(!protocols&&!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(key))return null;
        const list=protocols?entry.data.protocols:entry.data.devices;
        const recorded=(list||[]).find(function(item){return (protocols?item.name:String(item.mac).toLowerCase())===key;});
        return recorded?Number(recorded.rx||0)+Number(recorded.tx||0):0;
    },
    description:function(entry,row,protocols){
        if(protocols&&row&&String(row.name).includes(':'))return '24h usage unavailable: this live port label has no matching recorded protocol.';
        if(row&&!protocols&&!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(row.mac)))return '24h usage unavailable: the device MAC address is not known.';
        if(!entry)return 'Loading recorded usage for the last 24 hours…';
        if(entry.error)return '24h usage unavailable: '+entry.error;
        if(!entry.data||!entry.data.last_sample)return 'No recorded history is available yet.';
        return 'Download + upload over the last 24 hours. Latest recorded sample: '+new Date(entry.data.last_sample*1000).toLocaleString()+'. Updated once per minute.';
    }
});
