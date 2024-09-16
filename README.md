Reverse engineered Canon BLE (Bluetooth Low Energy) protocol (used by the Camera Connect mobbile app) and its demo implementation using Web Bluetooth: https://3bl3gamer.github.io/canon-bluetooth-control/

Tested with Canon EOS M6. Other models may have different shooting API. For example check out [BR-M5](https://github.com/ArthurFDLR/BR-M5/blob/02b158d3c842d7ad9a6f3f7b98966e8590d70814/lib/CanonBLERemote/src/CanonBLERemote.cpp#L276-L279) where shutter service with UUID `00050003-0000-1000-0000-d8492fffa821` is used.

## Connection process

### Pairing

First, the camera should be paired with another bluetooth device in a traditional bluetooth way. If it has been previously paired but something went wrong during handshake, camera must be unpaired first.

Web Bluetooth does not support such pairing, so if you want to try this demo, you will have to first manually pair the camera via your OS UI (such as `bluetoothctl pair <address>` on Linux). If you will re-implement this API using `python` and [bleak](https://bleak.readthedocs.io/), you may use `await client.pair()`.


### Handshaking

Camera also calles this step "pairing" but here I will call it "handshaking" to distinguish it from regular bluetooth process.

If new device has just been paired:

1. start handshake by sending device name prefixed by `01` (see handle `0xf108`)
2. wait for notification and check if value is `02` (see handle `0xf108`)
3. send device ID, name and type (see handle `0xf104`)
4. (optional) initialize Wi-Fi info (see handle `0xf204`)
5. send handshake finish marker (see handle `0xf104`)

If device has been previously paied and handshaked, only steps 4 and 5 should be performed. Although if they are omitted, everything (except starting Wi-Fi AP) seems still working.


### Taking photos, recording videos

Just send two commands: shutter press+release (for stills) or video start+end (see handle `0xf311`).

Ensure camera is in shooting mode, it will not switch from playback automatically.


## Services

All readings are for Canon EOS M6.


### Device info

UUID: `0000180a-0000-1000-8000-00805f9b34fb`

Does not require pairing or handshake.

Characteristics:

 * `00002a29-0000-1000-8000-00805f9b34fb` (`0x0032`) — manufacturer name
   * read returns `"Canon Inc.\000"` (null-terminated)
 * `00002a24-0000-1000-8000-00805f9b34fb` (`0x0034`) — model number
   * read returns `"32c5\000"`
 * `00002a26-0000-1000-8000-00805f9b34fb` (`0x0036`) — firmware version
   * read returns `"1.0.0\000"`
 * `00002a28-0000-1000-8000-00805f9b34fb` (`0x0038`) — software version
   * read returns `"1.0.0\000"`

### Handshake

UUID: `00010000-0000-1000-0000-d8492fffa821`

Characteristics:

 * `00010005-0000-1000-0000-d8492fffa821` (`0xf102`) — unknown
   * read returns `01`
 * `0001000a-0000-1000-0000-d8492fffa821` (`0xf104`) — transferring device information to camera, ending handshake
   * write `03`+16 bytes — sort of device ID, may be random; not required but without it handshaken device will be forgotten by camera after turning off and on
   * write `04`+some bytes — device name
   * write `05`+one byte — device type (differences are yet unknown)
     * `0501` — iOS
     * `0502` — Android
     * `0503` — Remocon (BR-E1 maybe? value from [CanonBLEIntervalometer](https://github.com/robot9706/CanonBLEIntervalometer))
   * write `01` — finish handshake
 * `0001000b-0000-1000-0000-d8492fffa821` (`0xf106`) — unknown
   * read returns `07000000`
 * `00010006-0000-1000-0000-d8492fffa821` (`0xf108`) — starting handshake
   * write `01`+some bytes — start handshake with provided device name (it will be show by the camera in the pairing confirmation dialog)
     * notifies with `02` if user pressed "OK" on the confirmation dialog
     * notifies with `03` if user pressed "Cancel" on the confirmation dialog


### Wi-Fi access point

UUID: `00020000-0000-1000-0000-d8492fffa821`

Characteristics:

 * `00020001-0000-1000-0000-d8492fffa821` (`0xf202`) — unknown
   * read returns `0f000000`
 * `00020002-0000-1000-0000-d8492fffa821` (`0xf204`) — Wi-Fi initialization and info
   * write `0a` populates Wi-Fi AP name and passwords characterstics (otherwise they return zeroes)
     * notifies with 19 bytes where [10:16] are a BSSID and others are unknown
   * write `01` starts Wi-Fi AP, disconects bluetooth
 * `00020003-0000-1000-0000-d8492fffa821` (`0xf207`) — result of Wi-Fi initialization
   * notifies with `0103` after writing `01` to `0xf204` and successful start of Wi-Fi AP
 * `00020004-0000-1000-0000-d8492fffa821` (`0xf20a`) — Wi-Fi AP name (SSID)
   * read returns `"EOSM6-858_Canon0A\000\000\000"` (last three bytes are zero)
 * `00020005-0000-1000-0000-d8492fffa821` (`0xf20c`) — unknown
   * read returns `09000000`
 * `00020006-0000-1000-0000-d8492fffa821` (`0xf20e`) — Wi-Fi AP password
   * read returns string with 8 digits like `"12345678"`


### Core camera operation (shooting, playback, suspend)

UUID: `00030000-0000-1000-0000-d8492fffa821`

 * `00030001-0000-1000-0000-d8492fffa821` (`0xf302`) — unknown
   * read returns `010101`
 * `00030002-0000-1000-0000-d8492fffa821` (`0xf304`) — unknown
   * notifies with `0313`
 * `00030010-0000-1000-0000-d8492fffa821` (`0xf307`) — modes swithing
   * write `01` switches to playback mode
   * write `02` switches to shooting mode
   * write `03` wakes up camera from suspend (which may be caused by writing `05` or by Auto Power Down timer from camera Power Saving menu)
   * write `04` exact purpose is unknown
     * write `03`, `04`, `03` (separately) can be used to turn screen back on if it was turned off by camera Display Off timer (from Power Saving menu); writing only `03` will not turn the scrren on, it must be `04` and then `03`; but if `04` will be written two times in a row, something will break until reconnection and many commands will start returning errors, so it is safier to write `03` then `04` and then `03` again
   * write `05` sends camera to suspend
   * write `06` is unknown
   * write `07`+ is unknown, first write is ok, but subsequent commands start returning errors
 * `00030011-0000-1000-0000-d8492fffa821` (`0xf309`) — result of switching modes
   * notifies with `04` after switching to shooting mode by writing `02` to `0xf307`, via camera buttons or after triggering wakeup in the shooting mode *only* by writing `03` to `0xf307` (not by pressing some camera buttons)
   * notifies with `03` after switching to playback mode by writing `02` to `0xf307`, via camera buttons or after triggering wakeup in the playback mode *only* by writing `03` to `0xf307` (not by pressing some camera buttons)
   * notifies with `01` before going into suspend
 * `00030020-0000-1000-0000-d8492fffa821` (`0xf30c`) — playback buttons
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
   * notifies with `dc010000` after entering playback mode or closing Quick Set menu, regular menu, stopping slideshow and exiting zooming during playback mode
   * notifies with `20000000` when Quich Set menu or regular menu is opened
   * notifies with `3f010000` when starting slideshow
   * notifies with `ff000000` when starting zooming
 * `00030030-0000-1000-0000-d8492fffa821` (`0xf311`) — shooting buttons
   * write `0001`/`0002` presses/releases shutter button
   * write `0010` starts video
   * write `0011` stops video
 * `00030031-0000-1000-0000-d8492fffa821` (`0xf313`) — shooting state notifications (there will be no events after handshake until wakeup or shooting mode is triggered (`0xf307`), even if camera is already in shooting mode)
   * notifies with `101010` when pressing focus button on camera (not when autofocusing actually ends) or when pressing video button on camera (not when recording is started)
   * notifies with `010101`
     * when releasing focus button on camera (if photo is not taken)
     * when photo preview ends (if was taken by camera shutter button)
     * when photo is taken after writing `0001` to `0xf311` (*before* preview ends!)
     * when autofocus has failed (after writing `0001` to `0xf311`)
     * when video recording is stopped
   * notifies with `010201` when autofocus is successful (or it is off) after writing `0001` to `0xf311`
   * notifies with `010102` when video recording is started (by camera button or bluetooth command)


## References

https://iandouglasscott.com/2017/09/04/reverse-engineering-the-canon-t7i-s-bluetooth-work-in-progress/

https://github.com/robot9706/CanonBLEIntervalometer

https://github.com/thorsten-l/CameraControl

https://github.com/ArthurFDLR/BR-M5

https://github.com/pklaus/canoremote


## May be useful for Wi-Fi communication

https://github.com/shezi/airmtp

https://github.com/featherbear/eos-ptp

https://github.com/JulianSchroden/cine_remote

[Camera Control API (CCAPI)](https://developers.canon-europe.com/s/camera)
