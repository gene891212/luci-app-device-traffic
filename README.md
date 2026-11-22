# Device Traffic

Live and historical per-device traffic monitoring for OpenWrt LuCI.

`luci-app-device-traffic` is derived from [EliotFerragni/luci-app-nlbw-history](https://github.com/EliotFerragni/luci-app-nlbw-history). It retains **nlbwmon** for historical accounting and reads **conntrack** directly for live rates. See [NOTICE](NOTICE) for provenance and [LICENSE](LICENSE) for the Apache-2.0 license.

## Features

- Live is the default page, with one-second polling and a three-minute window.
- Separate download and upload charts, stacked vertically; bar, smooth line and filled area modes.
- MB/s by default, numeric Y axes with the unit in each chart title, and 24-hour clock labels.
- Host, IPv4 and MAC identification, fixed-width live columns, and clickable sorting without arrow icons.
- Rolling **24h Usage** from recorded download + upload totals; refreshed once per minute. Live opens sorted by this column, largest first.
- Device/protocol filtering, chart visibility toggles, history ranges and calendar months.
- LuCI theme styling and responsive horizontal table scrolling.

Live rates are approximate: polling can miss short connections, and offloaded counters may arrive in batches. Historical totals use nlbwmon instead. Protocol names are port-based labels, not deep packet inspection. Raw live port labels without a matching historical protocol, or devices without a known MAC, display `—` for unavailable historical usage.

## Requirements and scope

- OpenWrt with LuCI, `nlbwmon`, `conntrack` and `rpcd-mod-ucode`.
- The published APK targets OpenWrt 25.12 and newer. The package contains shell, ucode, JavaScript and CSS; there is no architecture-specific executable in it.
- Runtime validation for the first release is on OpenWrt 25.12.5 x86_64 with the Argon theme. Other architectures/themes and a full router reboot have not been validated for this release.
- Historical data needs persistent writable storage. The default is `/srv/traffic-monitor`.

The package does not change firewall rules, routing, DNS or offload settings. Existing `luci-app-nlbwmon` and the original `luci-app-nlbw-history` can remain installed.

## Install

Download the APK and `SHA256SUMS` from [Releases](https://github.com/gene891212/luci-app-device-traffic/releases). Verify the checksum, copy the APK to the router, and install it:

```sh
sha256sum -c SHA256SUMS
apk add nlbwmon conntrack rpcd-mod-ucode
apk add --allow-untrusted /tmp/luci-app-device-traffic-1.0.1-r1.apk
```

Release APKs are currently unsigned, so installation requires `--allow-untrusted`. No signed package feed or automatic update service is provided.

Open **Services → Device Traffic**. The tabs are **Live / History / Settings**.

## Rename from Traffic Monitor 1.0.0

The package is now `luci-app-device-traffic`. Runtime names (`traffic-monitor`), configuration, history paths and browser preferences are deliberately retained, so no history conversion or data-directory move is needed. The old Traffic Monitor page URLs remain hidden aliases.

Keep the old APK available for rollback. Back up the configuration, hold the shared dependencies while replacing the package, and skip removal/install scripts during this one-time rename:

```sh
cp -p /etc/config/traffic-monitor /root/traffic-monitor-before-device-rename
/etc/init.d/traffic-monitor stop
traffic-monitor-live --stop
apk add --virtual .device-traffic-rename-deps luci-base nlbwmon conntrack rpcd-mod-ucode
apk del --scripts=no luci-app-traffic-monitor
apk add --allow-untrusted --scripts=no /tmp/luci-app-device-traffic-1.0.1-r1.apk
cp -p /root/traffic-monitor-before-device-rename /etc/config/traffic-monitor
/etc/init.d/traffic-monitor enable
/etc/init.d/traffic-monitor start
apk del --scripts=no .device-traffic-rename-deps
/etc/init.d/rpcd reload
```

Do not install both package names simultaneously: they own the same retained runtime files. If the new install fails, reinstall the previous APK with scripts disabled, restore the configuration, and restart the service before removing the temporary dependency holder. Refresh LuCI after the switch.

## Migrate from the local custom package

The migration command specifically supports `luci-app-nlbw-history-custom`, the development predecessor of this package. It does not import the upstream `luci-app-nlbw-history` service's independent history.

Install the new APK without running its scripts, leave the old package installed, then review and apply the migration:

```sh
apk add --allow-untrusted --scripts=no /tmp/luci-app-device-traffic-1.0.1-r1.apk
traffic-monitor-migrate --dry-run
traffic-monitor-migrate --apply
```

The migration stops/disables the old historical sampler, flushes buffered samples, creates a private backup under `/root/traffic-monitor-migration-*`, copies the counter baseline and history, then enables/starts the new sampler. The old default data directory is copied to `/srv/traffic-monitor`; a separately configured custom data directory is preserved. Old history is not deleted. Browser display preferences are imported on first access, and old local-custom page URLs remain aliases.

After verifying the new service, remove only the old custom package and reload rpcd:

```sh
apk del --scripts=no luci-app-nlbw-history-custom
/etc/init.d/rpcd reload
```

If an old Live page was left polling, close/reload it during the switch. Its former sampler can otherwise stay alive briefly. Refresh LuCI after changing package/menu names. See [DEVELOPMENT.md](DEVELOPMENT.md) for verification and rollback details.

## Configuration

Settings are available in LuCI and `/etc/config/traffic-monitor`:

| Option | Default | Purpose |
| --- | --- | --- |
| `period` | `60` | Historical sampling interval, seconds |
| `retention` | `30` | History retention, days |
| `flush_interval` | `60` | RAM spool flush interval, seconds |
| `data_dir` | `/srv/traffic-monitor` | Persistent history directory |
| `protocols` | `1` | Record per-protocol history |
| `protocol_interval` | `900` | Historical protocol aggregation interval, seconds |
| `max_rate` | `10000` | Reject implausible samples above this Mbit/s ceiling |
| `live_interval` | `1` | Live polling interval, seconds |
| `live_window` | `180` | Live chart window, seconds |
| `chart_type` | `area` | `bar`, `line` or `area` |
| `time_format` | `24` | `auto`, `12` or `24` |
| `date_format` | `auto` | `auto`, `dmy` or `mdy` |

Which networks count and how ports are named remain controlled by nlbwmon. Displaying 24h usage once per minute does not change historical sampling accuracy or the live polling interval.

## Build

```sh
sh build-apk.sh
```

This uses apk-tools 3 locally or the pinned Alpine container declared in the build script. Alternatively, copy `package/luci-app-device-traffic` into an OpenWrt SDK and build that package normally. See [DEVELOPMENT.md](DEVELOPMENT.md).
