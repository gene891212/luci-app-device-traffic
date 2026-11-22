# Development and recovery

## Source layout

The OpenWrt package lives in `package/luci-app-traffic-monitor`. Its installed files are explicit in the package Makefile. `build-apk.sh` reads package metadata and scripts through `tools/pkg-meta.sh`; its staged payload must match the Makefile's install list.

| Component | Installed location |
| --- | --- |
| UCI configuration | `/etc/config/traffic-monitor` |
| Historical service | `/etc/init.d/traffic-monitor` |
| Collector, query, live and migration commands | `/usr/bin/traffic-monitor-*` |
| RPC object | `luci_traffic_monitor` |
| RPC source | `/usr/share/rpcd/ucode/luci.traffic_monitor.uc` |
| LuCI entry | `/cgi-bin/luci/admin/services/traffic-monitor` |
| Persistent history | Configured `data_dir`, default `/srv/traffic-monitor` |
| Volatile sampler state | `/tmp/traffic-monitor` |

The older local-custom URL remains a hidden alias. Legacy browser storage keys are read as a one-time fallback; newly saved choices use the Traffic Monitor namespace.

## Local checks

```sh
node tools/check-source.cjs
node tools/test.cjs
sh build-apk.sh
```

The standalone build uses apk-tools 3 or Docker. Its Alpine image is pinned by digest. `tools/write-makefile.cjs` regenerates the explicit install list after installed files are added or renamed; commit the resulting Makefile with the change.

For an SDK build, copy `package/luci-app-traffic-monitor` into the SDK's `package` directory, select the package under LuCI → Applications, and run:

```sh
make package/luci-app-traffic-monitor/compile V=s
```

An APK built without a signing key is unsigned. Publishing a release APK does not register a signed feed or configure automatic router upgrades.

## On-router verification

Check the service, data access and the RPC object separately:

```sh
/etc/init.d/traffic-monitor running
traffic-monitor-collect --status
traffic-monitor-live --status
ubus -v list luci_traffic_monitor
```

In LuCI verify Live rates keep changing, MB/s and 24-hour time labels, chart heights, fixed table widths, 24h Usage sorting, History filters and Settings. Opening a page is not equivalent to testing settings persistence, a service restart or a full router reboot.

The first release retains historical protocol aggregation at 900 seconds. Per-device history is sampled every 60 seconds. The Live 24h Usage column reads this stored history in the background rather than integrating the approximate Live graph.

## Migration backup

`traffic-monitor-migrate --apply` creates a private `/root/traffic-monitor-migration-*` directory containing the old configuration, installed files, flushed historical data, counter baselines and history checksums. `/etc/traffic-monitor.migration` records its path and makes a completed migration idempotent.

Never publish that directory, a runtime snapshot or a real configuration export. The migration is for the former local-custom package only; the original upstream service remains independent.

If migration exits before completion, it attempts to stop the new service and restart the old sampler. It retains its backup and any copied data for inspection. A failed migration must be inspected before another apply attempt; it will not overwrite a nonempty target directory.

## Rollback after a successful migration

Keep the previous local-custom APK available before removing the old package. This is a namespace/data-location migration; the historical TSV format is unchanged.

1. Close the new and old Live/History pages so they stop polling.
2. Stop/disable `traffic-monitor` and run `traffic-monitor-live --stop`. Stopping the historical service flushes its RAM buffer.
3. Reinstall the previous `luci-app-nlbw-history-custom` APK with scripts disabled, if it was removed.
4. Restore the backed-up old configuration. Before starting the old sampler, copy the **latest** new historical files and the latest counter-baseline files (`state`, `state.proto`, `lastsample`, `lastflush`, and any remaining spool files) back to the old locations. This preserves samples recorded after migration and avoids counting the same delta twice. For a custom shared data directory, retain the shared history and transfer the current baseline only.
5. Enable/start the old sampler, remove the new package with scripts disabled, then reload rpcd and refresh LuCI.

Preserve both data directories and the migration backup until the rollback is verified. Do not roll back by swapping an APK while leaving mismatched sampler state.

## Release checklist

Run source checks/tests and build the APK. Validate the target router migration and UI, then create a release tag such as `traffic-monitor-v1.0.0`. Attach the APK and a `SHA256SUMS` file. Public release material must not include hostnames, client MAC/IP lists, runtime data, local paths or private backup archives.
