import { Peer } from 'peerjs'

let isInitialized = false

const init = async () => {
	if (isInitialized || document.readyState === 'loading') return

	isInitialized = true

	const main = document.body.querySelector('main')

	const connectionLinkElement = main.querySelector('#connection-link')
	const inputDeviceSelect = main.querySelector('select#input-device-select')
	const localPeerIdElement = main.querySelector('#local-peer-id')
	const loopbackAudioElement = main.querySelector('audio#loopback-audio')
	const loopbackVolumeSlider = main.querySelector('input#loopback-volume-slider')
	const outputDeviceSelect = main.querySelector('select#output-device-select')
	const receivingAudioElement = main.querySelector('audio#receiving-audio')
	const receivingMutedCheckbox = main.querySelector('input#receiving-muted-checkbox')
	const receivingVolumeSlider = main.querySelector('input#receiving-volume-slider')
	const remotePeerIdElement = main.querySelector('#remote-peer-id')
	const sendingMutedCheckbox = main.querySelector('input#sending-muted-checkbox')

	let currentCall
	let currentConnectionToRemotePeer
	let isSendingMuted = false
	let localPeer
	let remotePeerId

	const populateAudioDeviceSelects = async () => {
		// this "stray" call to `getUserMedia` ensures that the user has granted microphone permissions before we try to enumerate audio devices, which could lead to empty <select>s
		await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

		const mediaDevices = await navigator.mediaDevices.enumerateDevices()

		inputDeviceSelect.innerHTML = outputDeviceSelect.innerHTML = null

		for (const device of mediaDevices) {
			const select = ((kind) => {
				switch (kind) {
					case 'audioinput': return inputDeviceSelect
					case 'audiooutput': return outputDeviceSelect
				}
			})(device.kind)
			if (! select) continue

			const option = document.createElement('option')

			option.label = device.label
			option.value = device.deviceId

			select.appendChild(option)
		}
	}

	const handleCall = (call) => {
		currentCall = call

		call.on('stream', (stream) => {
			console.info('received stream', stream)
			remotePeerIdElement.innerText = remotePeerId
			receivingAudioElement.srcObject = stream
			receivingAudioElement.play()
		})

		call.on('error', (err) => {
			console.error('error in call connection', err)
		})

		call.on('close', () => {
			console.error('call connection closed')
			currentCall = null
		})
	}

	const setUpLocalPeer = () => new Promise((resolve, reject) => {
		localPeer = new Peer({
			debug: 1,
			secure: true,
		})

		localPeer.on('error', (err) => {
			console.error('broker connection failed', err)
			reject(err)
		})

		localPeer.on('open', () => {
			console.info('connected to broker, local peer id:', localPeer.id)
			localPeerIdElement.innerText = localPeer.id

			const connectionLink = new URL(window.location.toString())
			connectionLink.hash = `#${localPeer.id}`

			connectionLinkElement.innerText = connectionLink.toString()
			resolve(localPeer)
		})

		localPeer.on('call', async (call) => {
			console.info('incoming call', call)

			if (currentCall?.open) {
				console.info('incoming call rejected because a call is already ongoing', call)
				call.close()
				call.peerConnection?.close()
				return
			}

			call.answer(await getAndUpdateSendingStream())
			remotePeerId = call.peer
			remotePeerIdElement.innerText = remotePeerId
			window.location.hash = `#${remotePeerId}`

			handleCall(call)
		})

		localPeer.on('connection', (connection) => {
			console.info('incoming connection', connection)

			if (currentCall?.open) {
				console.info('incoming connection rejected because a call is already ongoing', connection)
				connection.close()
			}
		})
	})

	const connectToRemotePeerFromUrlHash = async () => {
		const remotePeerIdFromUrlHash = window.location.hash?.substring(1)
		if (! remotePeerIdFromUrlHash) return
		if (remotePeerId === remotePeerIdFromUrlHash) return

		if (currentCall) {
			console.info('closing call with', remotePeerId, 'because hash changed')
			currentCall.close()
		}

		remotePeerId = remotePeerIdFromUrlHash

		console.info('connecting to remote peer from url hash, remote peer id:', remotePeerId)
		connectToRemotePeer()
	}

	const connectToRemotePeer = async () => {
		if (! remotePeerId) return

		console.info('connecting to remote peer', remotePeerId)
		remotePeerIdElement.innerText = `connecting to ${remotePeerId}`

		currentConnectionToRemotePeer = localPeer.connect(remotePeerId)

		currentConnectionToRemotePeer.on('error', (err) => {
			console.error('error in connection to remote peer', err)
		})

		currentConnectionToRemotePeer.on('close', () => {
			console.info('connection to remote peer closed')
			currentConnectionToRemotePeer = null
		})

		const call = localPeer.call(remotePeerId, await getAndUpdateSendingStream())
		handleCall(call)
	}

	const setAudioElementSink = async () => {
		console.info('setting playback device to device id', outputDeviceSelect.value)

		await Promise.all([
			receivingAudioElement.setSinkId(outputDeviceSelect.value),
			loopbackAudioElement.setSinkId(outputDeviceSelect.value),
		])
	}

	const getAndUpdateSendingStream = async () => {
		console.info('getting sending stream from device id', inputDeviceSelect.value)

		const stream = await navigator.mediaDevices.getUserMedia({
			video: false,

			audio: {
				autoGainControl: true,
				deviceId: inputDeviceSelect.value,
				noiseSuppression: true,
			},
		})

		for (const track of stream.getTracks()) {
			track.enabled = !isSendingMuted
		}

		loopbackAudioElement.srcObject = stream
		loopbackAudioElement.play()

		if (currentCall?.peerConnection?.getSenders()?.[0]) {
			currentCall.peerConnection.getSenders()[0].replaceTrack(stream.getAudioTracks()[0])
		}

		return stream
	}

	const setLoopbackVolume = () => {
		loopbackAudioElement.muted = false
		loopbackAudioElement.volume = loopbackVolumeSlider.value
	}

	const setReceivingVolume = () => {
		receivingAudioElement.muted = false
		receivingAudioElement.volume = receivingVolumeSlider.value
	}

	const setSendingMuted = async () => {
		isSendingMuted = sendingMutedCheckbox.checked
		await getAndUpdateSendingStream()
	}

	const setReceivingMuted = () => {
		receivingAudioElement.muted = receivingMutedCheckbox.checked
	}

	const onBeforeunload = (e) => {
		if (! currentCall?.open) return

		e.preventDefault()
		e.returnValue = 'You\'re still connected!'

		return 'You\'re still connected!'
	}

	connectionLinkElement.addEventListener('click', () => navigator.clipboard.writeText(connectionLinkElement.innerText))
	inputDeviceSelect.addEventListener('input', () => getAndUpdateSendingStream())
	loopbackVolumeSlider.addEventListener('input', () => setLoopbackVolume())
	navigator.mediaDevices.addEventListener('devicechange', () => populateAudioDeviceSelects())
	outputDeviceSelect.addEventListener('input', () => setAudioElementSink())
	receivingMutedCheckbox.addEventListener('change', () => setReceivingMuted())
	receivingVolumeSlider.addEventListener('input', () => setReceivingVolume())
	sendingMutedCheckbox.addEventListener('change', () => setSendingMuted())
	window.addEventListener('beforeunload', (e) => onBeforeunload(e))
	window.addEventListener('hashchange', () => connectToRemotePeerFromUrlHash())

	await Promise.all([
		getAndUpdateSendingStream(),
		populateAudioDeviceSelects(),
		setAudioElementSink(),
		setUpLocalPeer(),
	])

	await connectToRemotePeerFromUrlHash()

	main.style.display = null
	document.querySelector('#loading').remove()
}

if (document.readyState === 'loading') {
	document.addEventListener('readystatechange', init())
	window.addEventListener('DOMContentLoaded', init())
}

requestAnimationFrame(() => init())
