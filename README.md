Reverse engineered Canon BLE (Bluetooth Low Energy) protocol (used by the Camera Connect mobile app) and its demo implementation using Web Bluetooth: https://3bl3gamer.github.io/canon-bluetooth-control/

Tested with Canon EOS M6. Other models may have different shooting API. For example check out [BR-M5](https://github.com/ArthurFDLR/BR-M5/blob/02b158d3c842d7ad9a6f3f7b98966e8590d70814/lib/CanonBLERemote/src/CanonBLERemote.cpp#L276-L279) where shutter service with UUID `00050003-0000-1000-0000-d8492fffa821` is used.

## Connection process

### Pairing

First, the camera should be paired with another Bluetooth device in a traditional Bluetooth way. If it has been previously paired but something went wrong during handshake, camera must be unpaired first.

Web Bluetooth does not support such pairing, so if you want to try this demo, you will have to first manually pair the camera via your OS UI (such as `bluetoothctl pair <address>` on Linux). If you will re-implement this API using `python` and [bleak](https://bleak.readthedocs.io/), you may use `await client.pair()`.

On Windows, a stale OS-level Bluetooth pairing may survive even after clearing the connection target on the camera. If enabling notifications or indications fails during handshake, remove the camera from Windows Bluetooth settings and pair it again.


### Handshaking

Camera also calls this step "pairing" but here I will call it "handshaking" to distinguish it from regular Bluetooth process.

If new device has just been paired, two orderings are known to work:

1. EOS M6 / original demo ordering:
   1. start handshake by sending device name prefixed by `01` (see handle `0xf108`)
   2. wait for notification and check if value is `02` (see handle `0xf108`)
   3. send device ID, name and type (see handle `0xf104`)
   4. (optional) initialize Wi-Fi info (see handle `0xf204`)
   5. send handshake finish marker (see handle `0xf104`)
2. Canon Camera Connect / furble / EOS RP ordering:
   1. subscribe to indications on `0xf108`
   2. write `01`+device name to `0xf108`
   3. write `03`+stable 16-byte device ID, `04`+device name and `05`+device type to `0xf104`
   4. wait for indication `02` on `0xf108` (accept) or `03` (reject/cancel)
   5. optionally subscribe to location indications on `00040003`
   6. write finish marker `01` to `0xf104`
   7. optionally write `02` to `0xf307` to enter shooting/recording mode

If device has been previously paired and handshaken, only the optional Wi-Fi initialization and finish marker are required for the original demo flow. In EOS M6 testing, omitting them did not break basic shooting commands, but Wi-Fi AP startup depended on initialization.

Additional observations from Canon Camera Connect and EOS RP testing:

* The 16-byte device ID should be stable for the same host/app target. Generating a new random ID on every run can make the camera treat the controller as a different device.


### Taking photos, recording videos

Just send two commands: shutter press+release (for stills) or video start+end (see handle `0xf311`).

Ensure camera is in shooting mode, it will not switch from playback automatically.


## Services

All readings are for Canon EOS M6.

Byte strings below are raw on-wire hex. Where Canon Camera Connect parses a 4-byte value as an integer, Android `ByteBuffer` uses big-endian byte order unless explicitly changed. Handles such as `0xf104` were observed on the EOS M6; UUIDs are the portable identifiers.


### Device info

UUID: `0000180a-0000-1000-8000-00805f9b34fb`

Does not require pairing or handshake.

Characteristics:

 * `00002a29-0000-1000-8000-00805f9b34fb` (`0x0032`) — manufacturer name
   * read returns `"Canon Inc.\000"` (null-terminated)
 * `00002a24-0000-1000-8000-00805f9b34fb` (`0x0034`) — model number
   * read returns `"32c5\000"`
 * `00002a25-0000-1000-8000-00805f9b34fb` — serial number
   * Canon Camera Connect reads it when present and stores the trimmed ASCII string
 * `00002a26-0000-1000-8000-00805f9b34fb` (`0x0036`) — firmware version
   * read returns `"1.0.0\000"`
 * `00002a28-0000-1000-8000-00805f9b34fb` (`0x0038`) — software version
   * read returns `"1.0.0\000"`

### Handshake

UUID: `00010000-0000-1000-0000-d8492fffa821`

Characteristics:

 * `00010005-0000-1000-0000-d8492fffa821` (`0xf102`) — BLE camera power state
   * read returns `01`
   * Canon Camera Connect maps the first byte as:
     * `00` — auto power off
     * `01` — power on
     * `02` — power switch off
     * anything else — not recognized by Canon Camera Connect
 * `0001000a-0000-1000-0000-d8492fffa821` (`0xf104`) — session control point (`SS_CP_OP_CODE` in Canon Camera Connect)
   * write `01` — `SUCCESS`, finish handshake
   * write `02` — `FAILURE`, defined by Canon Camera Connect but not used in the normal accepted handshake path
   * write `03`+16 bytes — `UUID`, stable device ID; if it changes every run, the camera may treat the controller as a different device
   * write `04`+some bytes — `NICK_NAME`, device name
   * write `05`+one byte — `TYPE`, device type
     * `0501` — iOS (reported by previous reverse engineering)
     * `0502` — Android (used by Canon Camera Connect for Android and by CanonBLEIntervalometer source)
     * `0503` — Remocon (listed by CanonBLEIntervalometer README; not confirmed as BR-E1 here, and BR-E1 uses the separate `00050000` service)
   * write `06` — `MODEL_NAME_1ST_HALF` request; response notification opcode `01` contains ASCII first half
   * write `07` — `MODEL_NAME_2ND_HALF` request; response notification opcode `02` contains ASCII second half
   * write `08` — `WIFI_FREQUENCY_BANDWIDTH` request; response notification opcode `03` contains one byte
   * write `0901` — `WIFI_SCAN_RESULT_LIST`, request first Wi-Fi scan result list chunk
   * write `0902` — `WIFI_SCAN_RESULT_LIST`, request next Wi-Fi scan result list chunk
   * write `0a01` — `PROHIBIT_AUTO_POWER_OFF`, prohibit auto power off
   * write `0a02` — `PROHIBIT_AUTO_POWER_OFF`, permit auto power off
   * write `0b` — `WIFI_SCAN_SECURITY_TYPE_LIST` request
   * write `0c` — `WIFI_CAMERA_AP_FREQUENCY_BANDWIDTH` request; response notification opcode `07` contains one byte (`01`, `02`, `04`, or `00` fallback)
   * notification opcode `04` is handled as the result of the auto-power-off permission command; result byte `01` is success, `02` and `03` are app error paths
   * notification opcode `05` carries Wi-Fi scan result list chunks; notification opcode `06` carries Wi-Fi scan security type list entries
 * `0001000b-0000-1000-0000-d8492fffa821` (`0xf106`) — app-mode feature flags
   * read returns `07000000`
   * Canon Camera Connect parses this characteristic as a big-endian 32-bit feature bitmap; the EOS M6 raw value above should not be interpreted as the later-app low-bit mask without model-specific verification
   * later Canon Camera Connect versions check these flags:
     * `0x08` — split model-name request support (`06`/`07` on `0xf104`)
     * `0x10` — Wi-Fi frequency bandwidth request support (`08` on `0xf104`)
     * `0x20` — Wi-Fi scan result list request support
     * `0x40` — prohibit/permit auto power off command support (`0a01`/`0a02` on `0xf104`)
     * `0x80` — app copies the Device Information firmware version into its camera-state firmware field
     * `0x100` — Wi-Fi scan security type list request support
     * `0x200` — Wi-Fi camera AP frequency bandwidth request support (`0c` on `0xf104`)
 * `00010006-0000-1000-0000-d8492fffa821` (`0xf108`) — starting handshake
   * write `01`+some bytes — start handshake with provided device name (it will be shown by the camera in the pairing confirmation dialog)
     * notifies with `02` if user pressed "OK" on the confirmation dialog
     * notifies with `03` if user pressed "Cancel" on the confirmation dialog


### Wi-Fi access point

UUID: `00020000-0000-1000-0000-d8492fffa821`

Characteristics:

 * `00020001-0000-1000-0000-d8492fffa821` (`0xf202`) — Wi-Fi AP feature/status flags
   * read returns `0f000000`
   * Canon Camera Connect gates `START_WITH_SECURITY_TYPE` on bit `0x10` of this big-endian bitmap and on security type `9` being present in `0xf20c`
 * `00020002-0000-1000-0000-d8492fffa821` (`0xf204`) — Wi-Fi AP control point
   * write `01` — `START`, starts Wi-Fi AP and then Bluetooth disconnects
   * write `02` — `STOP`, stops Wi-Fi AP
   * write `03` — `REQUEST_CANCEL`, requests Wi-Fi AP start cancellation
   * write `0400000009` — `START_WITH_SECURITY_TYPE`, starts Wi-Fi AP with 32-bit big-endian security type `9`; Canon Camera Connect only sends it when supported by `0xf202` and `0xf20c`
   * write `0a` — `REQUEST_AP_CONFIG`, requests Wi-Fi AP config and populates Wi-Fi AP name, password and security type characteristics (otherwise they return zeroes)
   * notification `10 ...` — AP config response; Canon Camera Connect skips the first two bytes and then parses TLV records:
     * TLV type `0x10` — camera IPv4 address (4 bytes)
     * TLV type `0x02` — camera BSSID (6 bytes)
     * TLV type `0x30` — wait time, rendered by the app as `<value>00`
 * `00020003-0000-1000-0000-d8492fffa821` (`0xf207`) — result of Wi-Fi initialization
   * notification format is `code subcode`
   * `0103` — `START` accepted after writing `01` to `0xf204`
   * `0203` — another accepted AP startup state handled by Canon Camera Connect
   * `0104` or `0105` — start rejected/error states
   * subcodes `02`, `06`, `07`, `08`, `09` and `0a` are also handled by the app as Wi-Fi handoff progress/cancel/result events
 * `00020004-0000-1000-0000-d8492fffa821` (`0xf20a`) — Wi-Fi AP name (SSID)
   * read returns `"EOSM6-858_Canon0A\000\000\000"` (last three bytes are zero)
 * `00020005-0000-1000-0000-d8492fffa821` (`0xf20c`) — Wi-Fi AP security type list
   * read returns `09000000`
   * Canon Camera Connect parses entries as 32-bit big-endian security type IDs; `00000009` is the type it can pass to `START_WITH_SECURITY_TYPE`
 * `00020006-0000-1000-0000-d8492fffa821` (`0xf20e`) — Wi-Fi AP password
   * read returns string with 8 digits like `"12345678"`

The `00020000` service appears to handle camera-created access point handoff. It does not appear to directly configure the camera to join an existing infrastructure Wi-Fi network. Canon Camera Connect uses a later camera session/native SDK path to send infrastructure SSID/password settings.


### Core camera operation (shooting, playback, suspend)

UUID: `00030000-0000-1000-0000-d8492fffa821`

 * `00030001-0000-1000-0000-d8492fffa821` (`0xf302`) — remote-control feature flags
   * read returns `010101`
   * Canon Camera Connect stores only the third byte as its feature bitmap
   * third-byte flag `0x02` — the app enables extra remocon shooting UI controls
   * third-byte flag `0x20` — the app enables movie/record-related remocon UI behavior
 * `00030002-0000-1000-0000-d8492fffa821` (`0xf304`) — remote-control error notification
   * notification format is two bytes: `error_group error_detail`
   * observed `0313` means group `03`, detail `13`; Canon Camera Connect maps this to internal remocon error code `7`
   * Canon Camera Connect has mappings for:
     * details `00`, `01`, `02` regardless of group
     * group `03` with details `10`, `11`, `12`, `13`, `14`
     * group `01` with details `10`, `11`, `12`, `13`
 * `00030010-0000-1000-0000-d8492fffa821` (`0xf307`) — remocon session command
   * write `01` — `PLAY_START`, switches to playback mode
   * write `02` — `REC_START`, switches to shooting/recording mode
   * write `03` — `ANY_START`, wakes camera from suspend in the last active remote mode (for example after writing `05` or after Auto Power Down)
   * write `04` — `END`, ends the current remote session mode without powering the camera off
     * observed EOS M6 behavior: `03`, `04`, `03` can turn the camera display back on after Display Off; writing only `03` does not turn the screen on, and writing `04` twice in a row can leave the session returning errors until reconnect
   * write `05` — `PW_OFF_END`, sends camera to suspend / remote power-off end
   * write `06` — `REC_FORCE_START`, force-starts shooting/recording mode
   * write `07`+ — no Canon Camera Connect enum value found; EOS M6 accepted a first write but later commands returned errors
 * `00030011-0000-1000-0000-d8492fffa821` (`0xf309`) — remocon session status
   * notifies with `01` — `OFF`, before going into suspend
   * notifies with `03` — `PLAY`, after switching to playback mode by writing `01` to `0xf307`, by camera buttons, or after `ANY_START` wakes into playback mode
   * notifies with `04` — `REC`, after switching to shooting mode by writing `02` to `0xf307`, by camera buttons, or after `ANY_START` wakes into shooting mode
   * notifies with `05` — `REC_MOV`, movie-recording remote session state
 * `00030020-0000-1000-0000-d8492fffa821` (`0xf30c`) — playback buttons
   * command format is a 4-byte button bitmask plus press type in the last byte
   * press type values used by Canon Camera Connect: `40` release (`UNPRESS`), `80` press (`PRESS`), `c0` press+release (`PRESS_UNPRESS`)
   * write `10000080`/`10000040` presses/releases middle button
   * write `08000080`/`08000040` presses/releases right button
   * write `04000080`/`04000040` presses/releases left button
   * write `01000080`/`01000040` presses/releases up button
   * write `02000080`/`02000040` presses/releases down button
   * write `40000080`/`40000040` presses/releases zoom in button
   * write `80000080`/`80000040` presses/releases zoom out button
   * write `000100c0`/`00010040` presses/releases slideshow button
   * write `200000c0`/`20000040` presses/releases back button (aborts slideshow, returns zoom to normal)
 * `00030021-0000-1000-0000-d8492fffa821` (`0xf30e`) — playback menus navigation
   * Canon Camera Connect decodes this as a bitfield over these named buttons: `UP`, `DOWN`, `LEFT`, `RIGHT`, `OK`, `BACK`, `TELE`, `WIDE`, `SLIDESHOW`
   * notifies with `dc010000` after entering playback mode or closing Quick Set menu, regular menu, stopping slideshow and exiting zooming during playback mode
   * notifies with `20000000` when Quick Set menu or regular menu is opened
   * notifies with `3f010000` when starting slideshow
   * notifies with `ff000000` when starting zooming
 * `00030030-0000-1000-0000-d8492fffa821` (`0xf311`) — shooting buttons
   * write `0001`/`0002` presses/releases shutter button
   * write `0010` starts video
   * write `0011` stops video
 * `00030031-0000-1000-0000-d8492fffa821` (`0xf313`) — shooting state notifications
   * notification format is three bytes; Canon Camera Connect stores them as event/state fields and maps the second and third bytes to internal shooting UI codes
   * there will be no events after handshake until wakeup or shooting mode is triggered (`0xf307`), even if camera is already in shooting mode
   * notifies with `101010` when pressing focus button on camera (not when autofocusing actually ends) or when pressing video button on camera (not when recording is started)
   * notifies with `010101`
     * when releasing focus button on camera (if photo is not taken)
     * when photo preview ends (if was taken by camera shutter button)
     * when photo is taken after writing `0001` to `0xf311` (*before* preview ends!)
     * when autofocus has failed (after writing `0001` to `0xf311`)
     * when video recording is stopped
   * notifies with `010201` when autofocus is successful (or it is off) after writing `0001` to `0xf311`
   * notifies with `010102` when video recording is started (by camera button or Bluetooth command)


### GPS/location

UUID: `00040000-0000-1000-0000-d8492fffa821`

Canon Camera Connect exposes this as BLE GPS status/select events. Furble independently identifies the same service as Canon EOS smart-device geotagging.

 * `00040001-0000-1000-0000-d8492fffa821` — GPS status / request indication
   * Canon Camera Connect reads and subscribes to it
   * if first byte has bit `0x02`, Canon Camera Connect writes `0500000000000000` to `00040002`
 * `00040002-0000-1000-0000-d8492fffa821` — GPS/location write characteristic
   * write `01`, `02` or `03` — GPS service request command values used by Canon Camera Connect
   * write `01` — enable/acknowledge location transfer after request `03` (furble)
   * write `05` followed by zero padding — request/select GPS state in Canon Camera Connect
   * write `06`+source byte followed by zero padding — set camera GPS source selection; source values match the `00040003` selection values below
   * write location payload with first byte `04` — location and time data (furble): latitude direction, latitude float32, longitude direction, longitude float32, elevation sign, elevation float32, Unix timestamp uint32
 * `00040003-0000-1000-0000-d8492fffa821` — GPS select/status indication
   * first byte `01` — `BLE_GPS_STATE_UNWANTED`
   * first byte `02` — `BLE_GPS_STATE_WANTED`
   * first byte `03` — `BLE_GPS_STATE_SETUP`
   * first byte `05` plus second byte — camera GPS source selection:
     * `00` — disable
     * `01` — GPS receiver
     * `02` — built-in GPS
     * `03` — built-in GPS, power switch off
     * `04` — smartphone
   * furble also observes indication `03` as a location request and `02` as location transfer success


### Livestream

UUID: `00080000-0000-1000-0000-d8492fffa821`

This service appears in later Canon Camera Connect app code. It is not part of the original EOS M6 demo behavior documented above, but the app names and packet structure are clear enough to record.

 * `00080001-0000-1000-0000-d8492fffa821` — livestream feature
   * Canon Camera Connect reads it as `BLE_UUID_LIVESTREAM_FEATURE`
 * `00080002-0000-1000-0000-d8492fffa821` — livestream control point
   * write `02`+status — `SET_STATUS`; status values are:
     * `01` — `NONE`
     * `02` — `TRANSITION`
     * `03` — `CONFIGURATION`
     * `04` — `READY`
     * `05` — `STARTING`
     * `06` — `STREAMING`
     * `07` — `STOPPING`
     * `08` — `COUNTDOWN`
     * `ff` — `ERROR`
     * `f0` — `ERROR_CONNECT_WIFI`
     * `f1` — `RETRY_CONNECT_WIFI`
   * write `03` — `GET_QUALITY_LIST`
   * write `04`+quality — `SET_QUALITY_VALUE`; quality payload is size, frame rate and bit rate, with bit `0x80` on size meaning rotated
   * write `05`+chunk — `SET_URL`; chunk format is 16-bit URL length, chunk index, up to 16 URL bytes
   * write `06` — get camera connected Wi-Fi info
 * `00080003-0000-1000-0000-d8492fffa821` — livestream status indication
   * indication `01`+status — current livestream status using the same status values above
   * indication `02`+result — result for `SET_STATUS`; `01` means success
   * indication `03`+quality list — up to six quality records; size values include `01` HD, `02` FHD, `03` 4K, `04` 8K
   * indication `04`+result — result for `SET_QUALITY_VALUE`; `01` means success
   * indication `05`+result — result for `SET_URL`; `01` means success
   * indication `06`+chunk — connected Wi-Fi SSID chunks
   * indication `07`+IP version/address — connected Wi-Fi IP address; version byte `02` means IPv6, otherwise IPv4


## References

https://iandouglasscott.com/2017/09/04/reverse-engineering-the-canon-t7i-s-bluetooth-work-in-progress/

https://github.com/robot9706/CanonBLEIntervalometer

https://github.com/thorsten-l/CameraControl

https://github.com/ArthurFDLR/BR-M5

https://github.com/pklaus/canoremote

https://github.com/gkoh/furble


## May be useful for Wi-Fi communication

https://github.com/shezi/airmtp

https://github.com/featherbear/eos-ptp

https://github.com/JulianSchroden/cine_remote

[Camera Control API (CCAPI)](https://developers.canon-europe.com/s/camera)
