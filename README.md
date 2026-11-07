<br>

<div align="center">
  <img src="https://raw.githubusercontent.com/TECH7Fox/sipcore-hass-integration/main/images/dark_logo.png" width="700" alt="SIP Core Logo"/>

<br>

**🚀 Make and receive SIP calls directly in your Home Assistant dashboard**
</div>

<br>

SIP Core, part of the SIP-HASS project, is the system that powers Home Assistant cards to make and receive SIP calls using WebRTC.
It includes official cards and popups, but also supports third-party cards.

<br>

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discordapp.com/invite/qxnDtHbwuD)
[![SIP-HASS Docs](https://img.shields.io/badge/SIP_HASS_Docs-%233ECC5F.svg?style=for-the-badge&logo=bookstack&logoColor=white)](https://tech7fox.github.io/sip-hass-docs/)
[![HACS Repository](https://img.shields.io/badge/HACS_Repository-%2341BDF5.svg?style=for-the-badge&logo=homeassistant&logoColor=white)](https://my.home-assistant.io/redirect/hacs_repository/?owner=TECH7Fox&repository=sipcore-hass-integration&category=integration)

</div>

## ✨ Features

  * 📞 Make and receive calls
  * 🔔 (Custom) Ringtones
  * 📹 Video calls
  * 🔢 DTMF support
  * 🪟 Popups for incoming calls
  * 🚀 Auto call on load (using `?call=<number>` in the URL)
  * 🎤 Audio device selection
  * 🛠️ API for third-party developers to build custom cards and popups

## Default Popup

<p float="left">
  <img height="300" hspace="20" alt="popup" src="https://raw.githubusercontent.com/TECH7Fox/sipcore-hass-integration/main/images/popup.png" />
  <img height="300" hspace="20" alt="popup_config" src="https://raw.githubusercontent.com/TECH7Fox/sipcore-hass-integration/main/images/popup_config.png" />
</p>

- 🚪 Automatically opens on incoming calls
- 📊 Audio Visualizer
- ⚙️ Menu to configure audio devices
  - 🐛 And shows debug information
- 🎮 Custom buttons
- 🔇 Mute mic & camera buttons

## Call Card

<img align="left" height="200" hspace="20" alt="call_card" src="https://raw.githubusercontent.com/TECH7Fox/sipcore-hass-integration/main/images/call_card.png" />

`custom:sip-call-card`
 
- 📊 Audio Visualizer
- 📹 Supports camera entities for video
- 🎮 Custom buttons for quick actions
- 🔇 Mute mic & camera buttons

<br>
<br>

### Call Card options (fork)

```yaml
type: custom:sip-call-card
camera_entity: camera.doorbell     # HA live view (fallback)
go2rtc_stream: doorbell            # go2rtc stream name, either:
go2rtc_url: https://go2rtc.example.com   #   a) go2rtc web UI as the browser reaches it (must be https if HA is)
# go2rtc_ingress: true             #   b) or via the go2rtc add-on's ingress (HA OS / Supervised)
# go2rtc_addon_slug: a889bffc_go2rtc
# live_provider: webrtc            # default mse
call_extension: "401"              # green button / tap calls this when idle
tap_to_call: true                  # tap the picture: call / answer / hang up
status_texts:                      # {name} = remote party
  idle: Citofono non collegato
  connected: Audio collegato
header: false                      # true: status + timer in a bar above the picture
extensions:
  "401":
    name: Citofono
buttons: []
```

The card-level picture stays on (without restarting) during calls with `call_extension`; calls with other extensions use that extension's own `camera_entity` / `go2rtc_*` keys. If go2rtc can't be reached through ingress, the card falls back to `camera_entity`.

<br>

## Contacts Card

<img align="right" height="250" hspace="20" alt="contacts_card" src="https://raw.githubusercontent.com/TECH7Fox/sipcore-hass-integration/main/images/contacts_card.png" />

`custom:sip-contacts-card`

- 📞 Start calls to users/numbers
- 👤 Option to hide your own user
- 🎨 Custom names & icons
- ✏️ Open field option
- 🟢 State color with status entity

<br>
<br>

## Call Button Card

`custom:sip-call-button`

A minimal card with a single button for a fixed extension.

- 🟢 Green call button when idle
- 🔴 Red hangup button while a call is active
- 🔁 Reflects an ongoing call when you navigate back to the page

```yaml
type: custom:sip-call-button
extension: "100"
name: Doorbell # optional
rainbow_border: true;
# override_icon: mdi:doorbell # optional
```

<br>
<br>

## 🔇 Noise Suppression

SIP Core can run audio through [RNNoise](https://jmvalin.ca/demo/rnnoise/) (a small neural-network denoiser) on top of the browser's own echo cancellation and noise suppression. Useful for tablets and wall panels with poor built-in audio processing.

Add this to the SIP Core config (Settings → Devices & Services → SIP Core → Configure):

```yaml
noise_suppression:
  microphone: true   # denoise your mic before it is sent
  remote: false      # denoise the audio you receive (e.g. a noisy doorbell)
  # The browser's own mic processing (default true). On Android these turn on the
  # phone's built-in voice-call effects, which can gate or crackle on speakerphone.
  browser_echo_cancellation: true
  browser_noise_suppression: false
  browser_auto_gain: false
mute_on_start: 3     # keep the mic muted for the first seconds while echo cancellers adapt
```

- Runs locally in the browser (AudioWorklet + WASM, ~150 KB loaded only when a call starts).
- If it cannot start (old browser, or audio blocked until the first tap), the call continues with unprocessed audio and a warning is logged in the browser console.
- RNNoise works best on steady background noise (fans, hum, traffic, wind); it cannot remove speaker echo, which is the job of the browser's echo cancellation.

<br>
<br>

## 📋 Requirements
For this to work you will need the following:
 * ☎️ A sip/pbx server (Works best with the [Asterisk add-on](https://github.com/TECH7Fox/Asterisk-add-on))
 * 🔒 HTTPS for Home Assistant
 * 📦 HACS for easy installation


## 📚 Wiki

You can find the installation instructions and guides on the documentation site: <kbd>[SIP-HASS Docs](https://tech7fox.github.io/sip-hass-docs/)</kbd>

## ⭐ Star History

<div align="center">
<img width="600" src="https://star-history.dera.page/svg?repos=TECH7Fox/sipcore-hass-integration,TECH7Fox/asterisk-hass-addons,TECH7Fox/asterisk-hass-integration&type=date&legend=top-left" alt="Star History Chart" />
</div>
