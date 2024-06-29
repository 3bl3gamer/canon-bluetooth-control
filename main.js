const HANDSHAKE_SERVICE_UUID = '00010000-0000-1000-0000-d8492fffa821'
const CORE_SERVICE_UUID = '00030000-0000-1000-0000-d8492fffa821'
const WIFI_SERVICE_UUID = '00020000-0000-1000-0000-d8492fffa821'
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb'

const DEVICE_NAME_HEX = bytes2hex(new TextEncoder().encode('Web BT'))

const PAIR_CONFIRMATION_RESP_OK = '02'
const PAIR_CONFIRMATION_RESP_CANCEL = '03'

const CAMERA_MODE_PLAYBACK = '01'
const CAMERA_MODE_SHOOTING = '02'
const CAMERA_MODE_WAKEUP = '03'
const CAMERA_MODE_RETURN = '04'
const CAMERA_MODE_SUSPEND = '05'

const CAMERA_BUTTON_SHUTTER = { press: '0001', release: '0002' }
const CAMERA_BUTTON_VIDEO = { start: '0010', stop: '0011' }

const CAMERA_BUTTON_MIDDLE = { press: '10000080', release: '10000040' }
const CAMERA_BUTTON_RIGHT = { press: '08000080', release: '08000040' }
const CAMERA_BUTTON_LEFT = { press: '04000080', release: '04000040' }
const CAMERA_BUTTON_UP = { press: '01000080', release: '01000040' }
const CAMERA_BUTTON_DOWN = { press: '02000080', release: '02000040' }
const CAMERA_BUTTON_ZOOM_IN = { press: '40000080', release: '40000040' }
const CAMERA_BUTTON_ZOOM_OUT = { press: '80000080', release: '80000040' }
const CAMERA_BUTTON_SLIDESHOW_START = { press: '000100c0', release: '00010040' }
const CAMERA_BUTTON_BACK = { press: '200000c0', release: '20000040' }

/** @param {() => unknown} onDisconnect */
async function cameraConnect(onDisconnect) {
	if (!navigator.bluetooth) throw new Error('web bluetooth is not supported')

	const device = await navigator.bluetooth.requestDevice({
		filters: [{ services: [HANDSHAKE_SERVICE_UUID] }],
		optionalServices: [CORE_SERVICE_UUID, WIFI_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
		//   acceptAllDevices: true,
		//   optionalServices: [SERVICE_UUID],
	})

	const gatt = device.gatt
	if (!gatt) throw new Error('gatt is not available')

	await gatt.connect()
	console.log('connected')

	device.addEventListener('gattserverdisconnected', () => {
		console.warn('disconnected')
		onDisconnect()
	})

	return gatt
}

/**
 * @param {BluetoothRemoteGATTServer} gatt
 * @param {boolean} isNew
 */
async function cameraHandshake(gatt, isNew) {
	const pairService = await gatt.getPrimaryService(HANDSHAKE_SERVICE_UUID)
	const pairDataChar = await pairService.getCharacteristic('0001000a-0000-1000-0000-d8492fffa821')
	const pairCommandChar = await pairService.getCharacteristic('00010006-0000-1000-0000-d8492fffa821')

	const wifiService = await gatt.getPrimaryService(WIFI_SERVICE_UUID)
	const wifiInitChar = await wifiService.getCharacteristic('00020002-0000-1000-0000-d8492fffa821')

	if (isNew) {
		const confirmationResponsePromise = (
			await waitSingleNotification(pairCommandChar)
		).resultPromise.then(buf => {
			const responseHex = bytes2hex(buf)
			if (responseHex === PAIR_CONFIRMATION_RESP_OK) return true
			if (responseHex === PAIR_CONFIRMATION_RESP_CANCEL) return false

			throw new Error(`unexpected pairing confirmation response: ${responseHex || '—'}`)
		})

		// sending handshake request
		await pairCommandChar.writeValueWithResponse(hex2bytes('01' + DEVICE_NAME_HEX))

		// waiting for confirmation from camera (pressing OK/Cancel on camera screen)
		if (!(await confirmationResponsePromise)) {
			throw new Error('pairing canceled on camera')
		}
		console.log('pairing confirmed on camera')

		// await pairDataChar.writeValueWithResponse(hex2bytes('03b87f2a43220efb9d6d4b6f1f7ef3c98a'))
		await pairDataChar.writeValueWithResponse(hex2bytes('030102030405060708090a0b0c0d0e0f10'))
		await pairDataChar.writeValueWithResponse(hex2bytes('04' + DEVICE_NAME_HEX))
		await pairDataChar.writeValueWithResponse(hex2bytes('0502'))
	}

	await wifiInitChar.writeValueWithResponse(hex2bytes('0a'))
	await pairDataChar.writeValueWithResponse(hex2bytes('01'))
}

/** @param {BluetoothRemoteGATTServer} gatt */
async function cameraGetDeviceInfo(gatt) {
	const infoService = await gatt.getPrimaryService(DEVICE_INFO_SERVICE_UUID)

	const manufChar = await infoService.getCharacteristic('00002a29-0000-1000-8000-00805f9b34fb')
	const manuf = new TextDecoder().decode(await manufChar.readValue()).replace(/\u0000*$/, '')

	const modelChar = await infoService.getCharacteristic('00002a24-0000-1000-8000-00805f9b34fb')
	const model = new TextDecoder().decode(await modelChar.readValue()).replace(/\u0000*$/, '')

	const firmwareChar = await infoService.getCharacteristic('00002a26-0000-1000-8000-00805f9b34fb')
	const firmware = new TextDecoder().decode(await firmwareChar.readValue()).replace(/\u0000*$/, '')

	const softwareChar = await infoService.getCharacteristic('00002a28-0000-1000-8000-00805f9b34fb')
	const software = new TextDecoder().decode(await softwareChar.readValue()).replace(/\u0000*$/, '')

	return [
		`Manufacturer name: ${manuf}`,
		`Model number: ${model}`,
		`Firmware version: ${firmware}`,
		`Software version: ${software}`,
	].join('\n')
}

/**
 * @param {BluetoothRemoteGATTServer} gatt
 * @param {string} modeHex
 */
async function cameraSwitchMode(gatt, modeHex) {
	const coreService = await gatt.getPrimaryService(CORE_SERVICE_UUID)
	const modeChar = await coreService.getCharacteristic('00030010-0000-1000-0000-d8492fffa821')
	await modeChar.writeValueWithResponse(hex2bytes(modeHex))
}

/** @param {BluetoothRemoteGATTServer} gatt */
async function cameraResetDisplayOffTimer(gatt) {
	const coreService = await gatt.getPrimaryService(CORE_SERVICE_UUID)
	const modeChar = await coreService.getCharacteristic('00030010-0000-1000-0000-d8492fffa821')
	await modeChar.writeValueWithResponse(hex2bytes(CAMERA_MODE_WAKEUP))
	await modeChar.writeValueWithResponse(hex2bytes(CAMERA_MODE_RETURN))
	await modeChar.writeValueWithResponse(hex2bytes(CAMERA_MODE_WAKEUP))
}

/**
 * @param {BluetoothRemoteGATTServer} gatt
 * @param {number} durationMs
 */
async function cameraPressShutter(gatt, durationMs) {
	const coreService = await gatt.getPrimaryService(CORE_SERVICE_UUID)
	const shootingButtonChar = await coreService.getCharacteristic('00030030-0000-1000-0000-d8492fffa821')
	await shootingButtonChar.writeValueWithResponse(hex2bytes(CAMERA_BUTTON_SHUTTER.press))
	await sleep(durationMs)
	await shootingButtonChar.writeValueWithResponse(hex2bytes(CAMERA_BUTTON_SHUTTER.release))
}

/** @param {BluetoothRemoteGATTServer} gatt */
async function cameraStartVideo(gatt) {
	const coreService = await gatt.getPrimaryService(CORE_SERVICE_UUID)
	const shootingButtonChar = await coreService.getCharacteristic('00030030-0000-1000-0000-d8492fffa821')
	await shootingButtonChar.writeValueWithResponse(hex2bytes(CAMERA_BUTTON_VIDEO.start))
}

/** @param {BluetoothRemoteGATTServer} gatt */
async function cameraStopVideo(gatt) {
	const coreService = await gatt.getPrimaryService(CORE_SERVICE_UUID)
	const shootingButtonChar = await coreService.getCharacteristic('00030030-0000-1000-0000-d8492fffa821')
	await shootingButtonChar.writeValueWithResponse(hex2bytes(CAMERA_BUTTON_VIDEO.stop))
}

/**
 * @param {BluetoothRemoteGATTServer} gatt
 * @param {{press:string, release:string}} buttonCodesHex
 */
async function cameraPressPlaybackButton(gatt, buttonCodesHex) {
	const coreService = await gatt.getPrimaryService(CORE_SERVICE_UUID)
	const playbackButtonChar = await coreService.getCharacteristic('00030020-0000-1000-0000-d8492fffa821')
	await playbackButtonChar.writeValueWithResponse(hex2bytes(buttonCodesHex.press))
	await playbackButtonChar.writeValueWithResponse(hex2bytes(buttonCodesHex.release))
}

/** @param {BluetoothRemoteGATTServer} gatt */
async function cameraStartWifiAccessPoint(gatt) {
	const wifiService = await gatt.getPrimaryService(WIFI_SERVICE_UUID)

	const wifiInitChar = await wifiService.getCharacteristic('00020002-0000-1000-0000-d8492fffa821')
	await wifiInitChar.writeValueWithResponse(hex2bytes('0a'))

	const wifiActivationStatusChar = await wifiService.getCharacteristic(
		'00020003-0000-1000-0000-d8492fffa821',
	)
	const wifiActivationChar = await wifiService.getCharacteristic('00020002-0000-1000-0000-d8492fffa821')
	const wifiActivationStatusPromise = (await waitSingleNotification(wifiActivationStatusChar)).resultPromise

	// const f202Char = await wifiService.getCharacteristic('00020001-0000-1000-0000-d8492fffa821')
	// console.log('f202', view2hex(await f202Char.readValue()))

	const apNameChar = await wifiService.getCharacteristic('00020004-0000-1000-0000-d8492fffa821')
	const apName = new TextDecoder().decode(await apNameChar.readValue()).replace(/\u0000*$/, '')

	const apPasswordChar = await wifiService.getCharacteristic('00020006-0000-1000-0000-d8492fffa821')
	const apPassword = new TextDecoder().decode(await apPasswordChar.readValue())
	// const f20cChar = await wifiService.getCharacteristic('00020005-0000-1000-0000-d8492fffa821')
	// console.log('f20c', view2hex(await f20cChar.readValue()))

	await wifiActivationChar.writeValueWithResponse(hex2bytes('01'))
	const responseHex = bytes2hex(await wifiActivationStatusPromise)
	if (responseHex !== '0103') throw new Error(`unexpected WiFi activation response: ${responseHex}`)

	return [
		`AP name: ${apName}`,
		`AP password: ${apPassword}`,
		`AP BSSID: available but not retrieved by this demo yet`,
	].join('\n')
}

/** @param {string} str */
function hex2bytes(str) {
	const buf = new Uint8Array(str.length / 2)
	for (let i = 0; i < str.length; i += 2) {
		buf[i / 2] = parseInt(str.slice(i, i + 2), 16)
	}
	return buf
}

/** @param {Uint8Array} buf */
function bytes2hex(buf) {
	let res = ''
	for (let i = 0; i < buf.length; i++) {
		res += buf[i].toString(16).padStart(2, '0')
	}
	return res
}

/** @param {DataView} dataView */
function view2hex(dataView) {
	return bytes2hex(new Uint8Array(dataView.buffer, dataView.byteOffset))
}

// /**
//  * @param {BluetoothRemoteGATTCharacteristic} char
//  * @param {(buf:Uint8Array|null) => unknown} callback
//  */
// async function startNotificationListener(char, callback) {
// 	function onNotification() {
// 		let buf = null
// 		if (char.value) buf = new Uint8Array(char.value.buffer, char.value.byteOffset)
// 		callback(buf)
// 	}

// 	await char.startNotifications()
// 	char.addEventListener('characteristicvaluechanged', onNotification)
// }

/**
 * @param {BluetoothRemoteGATTCharacteristic} char
 * @returns {Promise<{resultPromise: Promise<Uint8Array>}>}
 */
async function waitSingleNotification(char) {
	await char.startNotifications()
	let onNotification

	const resultPromise = new Promise((resolve, reject) => {
		onNotification = function onNotification() {
			if (!char.value) {
				reject(new Error('got notification with empty value'))
			} else {
				resolve(new Uint8Array(char.value.buffer, char.value.byteOffset))
			}
		}
		char.addEventListener('characteristicvaluechanged', onNotification)
	}).finally(async () => {
		if (onNotification) char.removeEventListener('characteristicvaluechanged', onNotification)
		await char.stopNotifications()
	})

	return { resultPromise }
}

/** @param {number} ms */
function sleep(ms) {
	return new Promise(res => setTimeout(res, ms))
}
