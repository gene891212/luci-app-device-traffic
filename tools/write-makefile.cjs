const fs=require('node:fs'),path=require('node:path');
const pkg=path.join(__dirname,'../package/luci-app-traffic-monitor'),files=path.join(pkg,'files');
function list(root,prefix=''){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(root,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();}
const names=list(files),directories=[...new Set(names.map(f=>path.posix.dirname(f)))];
const install=[...directories.map(d=>'\t$(INSTALL_DIR) $(1)/'+d),...names.map(f=>'\t$('+(f.startsWith('etc/config/')?'INSTALL_CONF':f.startsWith('etc/init.d/')||f.startsWith('usr/bin/')?'INSTALL_BIN':'INSTALL_DATA')+') ./files/'+f+' $(1)/'+f)].join('\n');
const text=`# Modified for Traffic Monitor from luci-app-nlbw-history; see NOTICE.
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-traffic-monitor
PKG_VERSION:=1.0.0
PKG_RELEASE:=2
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Traffic Monitor contributors
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-traffic-monitor
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Live and historical per-device traffic monitor
  DEPENDS:=+luci-base +nlbwmon +conntrack +rpcd-mod-ucode
endef

define Package/luci-app-traffic-monitor/description
 Live per-device rates from conntrack, rolling 24-hour usage and historical
 graphs from nlbwmon counters. Includes host/IP identification, sortable
 tables, bar/line/area charts, and configurable display and sampling.
endef

define Package/luci-app-traffic-monitor/conffiles
/etc/config/traffic-monitor
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-traffic-monitor/install
${install}
endef

define Package/luci-app-traffic-monitor/postinst
#!/bin/sh
[ -n "$\{IPKG_INSTROOT}" ] && exit 0
if [ -x /etc/init.d/nlbw-history-custom ] && /etc/init.d/nlbw-history-custom running >/dev/null 2>&1; then
    echo 'Local-custom sampler detected. Run traffic-monitor-migrate --dry-run, then --apply before removing the old package.'
else
    /etc/init.d/traffic-monitor enable
    /etc/init.d/traffic-monitor stop >/dev/null 2>&1
    /etc/init.d/traffic-monitor start
fi
/etc/init.d/rpcd reload >/dev/null 2>&1
rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /tmp/luci-modulecache
exit 0
endef

define Package/luci-app-traffic-monitor/prerm
#!/bin/sh
[ -n "$\{IPKG_INSTROOT}" ] && exit 0
/etc/init.d/traffic-monitor stop >/dev/null 2>&1
/usr/bin/traffic-monitor-live --stop >/dev/null 2>&1
[ "$1" = "upgrade" ] || /etc/init.d/traffic-monitor disable >/dev/null 2>&1
exit 0
endef

define Package/luci-app-traffic-monitor/postrm
#!/bin/sh
[ -n "$\{IPKG_INSTROOT}" ] && exit 0
rm -rf /tmp/traffic-monitor
rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /tmp/luci-modulecache
/etc/init.d/rpcd reload >/dev/null 2>&1
# Persistent history and the migration backup are deliberately retained.
exit 0
endef

$(eval $(call BuildPackage,luci-app-traffic-monitor))
`;
// OpenWrt expands the bodies through make; the standalone builder reverses $$.
const escaped=text.replaceAll('${IPKG_INSTROOT}',()=>'$${IPKG_INSTROOT}').replaceAll('"$1"',()=>'"$$1"');
fs.writeFileSync(path.join(pkg,'Makefile'),escaped);console.log('Makefile includes '+names.length+' files.');
