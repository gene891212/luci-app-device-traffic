# Modified for Traffic Monitor from luci-app-nlbw-history; see NOTICE.
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
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DIR) $(1)/www/luci-static/resources/traffic-monitor
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/traffic-monitor
	$(INSTALL_CONF) ./files/etc/config/traffic-monitor $(1)/etc/config/traffic-monitor
	$(INSTALL_BIN) ./files/etc/init.d/traffic-monitor $(1)/etc/init.d/traffic-monitor
	$(INSTALL_BIN) ./files/usr/bin/traffic-monitor-collect $(1)/usr/bin/traffic-monitor-collect
	$(INSTALL_BIN) ./files/usr/bin/traffic-monitor-live $(1)/usr/bin/traffic-monitor-live
	$(INSTALL_BIN) ./files/usr/bin/traffic-monitor-loop $(1)/usr/bin/traffic-monitor-loop
	$(INSTALL_BIN) ./files/usr/bin/traffic-monitor-migrate $(1)/usr/bin/traffic-monitor-migrate
	$(INSTALL_BIN) ./files/usr/bin/traffic-monitor-query $(1)/usr/bin/traffic-monitor-query
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-traffic-monitor.json $(1)/usr/share/luci/menu.d/luci-app-traffic-monitor.json
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-traffic-monitor.json $(1)/usr/share/rpcd/acl.d/luci-app-traffic-monitor.json
	$(INSTALL_DATA) ./files/usr/share/rpcd/ucode/luci.traffic_monitor.uc $(1)/usr/share/rpcd/ucode/luci.traffic_monitor.uc
	$(INSTALL_DATA) ./files/www/luci-static/resources/traffic-monitor/chart.js $(1)/www/luci-static/resources/traffic-monitor/chart.js
	$(INSTALL_DATA) ./files/www/luci-static/resources/traffic-monitor/layout.css $(1)/www/luci-static/resources/traffic-monitor/layout.css
	$(INSTALL_DATA) ./files/www/luci-static/resources/traffic-monitor/table.js $(1)/www/luci-static/resources/traffic-monitor/table.js
	$(INSTALL_DATA) ./files/www/luci-static/resources/traffic-monitor/usage.js $(1)/www/luci-static/resources/traffic-monitor/usage.js
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/traffic-monitor/history.js $(1)/www/luci-static/resources/view/traffic-monitor/history.js
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/traffic-monitor/live.js $(1)/www/luci-static/resources/view/traffic-monitor/live.js
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/traffic-monitor/settings.js $(1)/www/luci-static/resources/view/traffic-monitor/settings.js
endef

define Package/luci-app-traffic-monitor/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
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
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/traffic-monitor stop >/dev/null 2>&1
/usr/bin/traffic-monitor-live --stop >/dev/null 2>&1
[ "$$1" = "upgrade" ] || /etc/init.d/traffic-monitor disable >/dev/null 2>&1
exit 0
endef

define Package/luci-app-traffic-monitor/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
rm -rf /tmp/traffic-monitor
rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /tmp/luci-modulecache
/etc/init.d/rpcd reload >/dev/null 2>&1
# Persistent history and the migration backup are deliberately retained.
exit 0
endef

$(eval $(call BuildPackage,luci-app-traffic-monitor))
