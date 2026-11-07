import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sipCore, CALLSTATE } from "./sip-core";
import { AudioVisualizer } from "./audio-visualizer";

declare global {
    interface Window {
        customCards?: Array<{ type: string; name: string; preview: boolean; description: string }>;
    }
}

interface Extension {
    name: string;
    status_entity: string | null;
    camera_entity: string | null;
    hidden: boolean | null;
    edit: boolean | null;
    override_icon: string | null;
    override_state: string | null;
}

enum ButtonType {
    SERVICE_CALL = "service_call",
    DTMF = "dtmf",
}

interface Button {
    label: string;
    icon: string;
    type: ButtonType;
    data: any;
}

/**
 * Status line texts. `{name}` is replaced with the remote party's name.
 */
interface StatusTexts {
    idle?: string;
    incoming?: string;
    outgoing?: string;
    connecting?: string;
    connected?: string;
}

const DEFAULT_STATUS_TEXTS: Required<StatusTexts> = {
    idle: "No active call",
    incoming: "Incoming call from {name}",
    outgoing: "Outgoing call to {name}",
    connecting: "Connecting to {name}",
    connected: "Connected to {name}",
};

interface CallCardConfig {
    buttons: Button[];
    extensions: { [key: string]: Extension };
    idle_text: string;
    camera_entity: string | null;
    largeUI: boolean;
    /** When idle, the green button calls this extension instead of being disabled */
    call_extension?: string;
    /** Show call status and duration in a bar above the image instead of in the footer */
    header?: boolean;
    /** Override the status line texts */
    status_texts?: StatusTexts;
    /**
     * Tapping the image/video: calls `call_extension` when idle, answers an
     * incoming call, and hangs up an active one
     */
    tap_to_call?: boolean;
}

@customElement("sip-call-card")
class SIPCallCard extends LitElement {
    @property()
    public hass = sipCore.hass;

    @property()
    public config: CallCardConfig | undefined;

    @state()
    private audioVisualizer: AudioVisualizer | undefined;

    setConfig(config: any) {
        this.config = config;
        // TODO: Check if config is valid
    }

    static getStubConfig() {
        return {
            extensions: {
                "100": {
                    name: "John Doe",
                },
                "101": {
                    name: "Joe Smith",
                },
                "102": {
                    name: "Doorbell",
                    override_icon: "mdi:doorbell",
                },
            },
            buttons: [],
        };
    }

    static get styles() {
        return css`
            ha-card {
                overflow: hidden;
                position: relative;
                height: 100%;
                /* Lets the footer scale with the card's own width (see @container below) */
                container-type: inline-size;
            }

            hui-image {
                display: block;
                width: 100%;
                height: auto;
                /* Reserve the frame while the live stream starts, so the card doesn't load tiny and jump */
                aspect-ratio: 16 / 9;
                background-color: #000;
            }

            #remoteVideo {
                width: 100%;
                height: auto;
            }

            ha-icon {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            #audioVisualizer {
                min-height: 230px;
                white-space: nowrap;
                align-items: center;
                display: flex;
                justify-content: center;
            }

            #audioVisualizer div {
                display: inline-block;
                width: 3px;
                height: 100px;
                margin: 0 7px;
                background: currentColor;
                transform: scaleY(0.5);
                opacity: 0.25;
            }

            .placeholder {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100%;
                background-color: var(--secondary-background-color);
                color: var(--primary-text-color);
                min-height: 230px;
            }

            .footer {
                position: absolute;
                left: 0px;
                right: 0px;
                bottom: 0px;
                background-color: var(--ha-picture-card-background-color, rgba(0, 0, 0, 0.3));
                padding: 4px 8px;
                font-size: 16px;
                color: var(--ha-picture-card-text-color, #fff);
                --mdc-icon-button-size: 40px;
            }

            .footer > div {
                display: flex;
                flex: none;
                align-items: center;
            }

            /* The status text takes the free space and is cut with "…" instead of wrapping over the video */
            .footer > div:first-child {
                flex: 1 1 auto;
                min-width: 0;
            }

            .both {
                display: flex;
                justify-content: space-between;
                gap: 4px;
            }

            .footer span {
                align-self: center;
                margin: 0 8px;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .footer[large] {
                font-size: 24px;
                --mdc-icon-button-size: 68px;
                --mdc-icon-size: 42px;
                padding: 14px;
            }

            .footer[large] span {
                margin: 0 16px;
            }

            /* Phones and narrow columns: smaller text and buttons so the bar stays one thin line */
            @container (max-width: 420px) {
                .footer,
                .footer[large] {
                    font-size: 13px;
                    padding: 2px 4px;
                    --mdc-icon-button-size: 34px;
                    --mdc-icon-size: 20px;
                }

                .footer span,
                .footer[large] span {
                    margin: 0 4px;
                }

                .header,
                .header[large] {
                    font-size: 14px;
                    padding: 6px 10px;
                    gap: 12px;
                }
            }

            .header {
                display: flex;
                align-items: center;
                gap: 24px;
                padding: 8px 16px;
                font-size: 18px;
                font-weight: 500;
                color: var(--primary-text-color);
                background-color: var(--secondary-background-color);
            }

            .header[large] {
                font-size: 24px;
                padding: 14px 20px;
            }

            .header .duration {
                font-variant-numeric: tabular-nums;
            }
        `;
    }

    private onMediaTap = () => {
        if (this.config?.tap_to_call !== true) return;
        switch (sipCore.callState) {
            case CALLSTATE.IDLE:
                if (this.config.call_extension) sipCore.startCall(String(this.config.call_extension));
                break;
            case CALLSTATE.INCOMING:
                sipCore.answerCall();
                break;
            default:
                sipCore.endCall();
                break;
        }
    };

    updateHandler = (event: any) => {
        this.requestUpdate();

        if (sipCore.remoteVideoStream !== null) {
            const videoElement = this.renderRoot.querySelector("#remoteVideo") as HTMLVideoElement;
            if (videoElement && videoElement.srcObject !== sipCore.remoteVideoStream) {
                videoElement.srcObject = sipCore.remoteVideoStream;
                videoElement.play();
            }
        } else {
            const videoElement = this.renderRoot.querySelector("#remoteVideo") as HTMLVideoElement;
            if (videoElement) {
                videoElement.srcObject = null;
                videoElement.pause();
            }
        }
    };

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener("sipcore-update", this.updateHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("sipcore-update", this.updateHandler);
    }

    render() {
        let camera: string = "";
        let statusText;
        let phoneIcon: string;
        let remoteName = this.config?.extensions?.[sipCore.remoteExtension || ""]?.name || sipCore.remoteName;
        const texts = { ...DEFAULT_STATUS_TEXTS, ...(this.config?.status_texts ?? {}) };
        const fill = (text: string) => text.replace(/\{name\}/g, remoteName ?? "");
        const callExtension = this.config?.call_extension ? String(this.config.call_extension) : "";
        const showHeader = this.config?.header === true;

        switch (sipCore.callState) {
            case CALLSTATE.IDLE:
                statusText = fill(texts.idle);
                phoneIcon = "mdi:phone";
                break;
            case CALLSTATE.INCOMING:
                statusText = fill(texts.incoming);
                phoneIcon = "mdi:phone-incoming";
                break;
            case CALLSTATE.OUTGOING:
                statusText = fill(texts.outgoing);
                phoneIcon = "mdi:phone-outgoing";
                break;
            case CALLSTATE.CONNECTED:
                statusText = fill(texts.connected);
                phoneIcon = "mdi:phone-in-talk";
                break;
            case CALLSTATE.CONNECTING:
                statusText = fill(texts.connecting);
                phoneIcon = "mdi:phone";
                break;
            default:
                statusText = "Unknown call state";
                phoneIcon = "mdi:phone";
                break;
        }

        if (
            sipCore.callState !== CALLSTATE.IDLE &&
            sipCore.remoteExtension !== null &&
            sipCore.remoteVideoStream === null
        ) {
            camera = this.config?.extensions?.[sipCore.remoteExtension]?.camera_entity || "";
            if (!camera) {
                if (sipCore.remoteAudioStream !== null) {
                    if (this.audioVisualizer === undefined) {
                        this.audioVisualizer = new AudioVisualizer(this.renderRoot, sipCore.remoteAudioStream, 16);
                    }
                } else {
                    this.audioVisualizer = undefined;
                }
            }
        }

        const isIdle = sipCore.callState === CALLSTATE.IDLE;

        return html`
            <ha-card>
                ${
                    showHeader
                        ? html`
                              <div ?large=${this.config?.largeUI} class="header">
                                  <span class="duration">${sipCore.callDuration}</span>
                                  <span>${statusText}</span>
                              </div>
                          `
                        : ""
                }
                <div
                    class="media"
                    style="cursor: ${this.config?.tap_to_call ? "pointer" : "auto"}"
                    @click=${this.onMediaTap}>
                <div id="audioVisualizer" style="display: ${
                    sipCore.callState !== CALLSTATE.IDLE && !camera && sipCore.remoteVideoStream === null
                        ? "flex"
                        : "none"
                }"></div>
                <video poster="noposter" style="display: ${
                    sipCore.remoteVideoStream === null ? "none" : "block"
                }" playsinline id="remoteVideo"></video>
                ${
                    sipCore.callState === CALLSTATE.IDLE
                        ? this.config?.camera_entity
                            ? html`
                                  <hui-image
                                      tabindex="0"
                                      .cameraImage=${this.config.camera_entity}
                                      .hass=${this.hass}
                                      .cameraView=${"live"}
                                      .aspectRatio=${"16:9"}
                                  ></hui-image>
                              `
                            : html`
                                  <div class="placeholder">
                                      <span>${this.config?.idle_text ?? "No active call"}</span>
                                  </div>
                              `
                        : camera
                        ? html`
                              <hui-image
                                  tabindex="0"
                                  .cameraImage=${camera}
                                  .hass=${this.hass}
                                  .cameraView=${"live"}
                                  .aspectRatio=${"16:9"}
                              ></hui-image>
                          `
                        : ""
                }
                </div>
                <div ?large=${this.config?.largeUI} class="footer both">
                    <div>
                        <ha-icon-button
                            style="color: var(--label-badge-green);"
                            label="${isIdle && callExtension ? "Call" : "Answer call"}"
                            ?disabled="${
                                isIdle ? !callExtension : sipCore.callState !== CALLSTATE.INCOMING
                            }"
                            @click="${() => {
                                if (isIdle && callExtension) sipCore.startCall(callExtension);
                                else sipCore.answerCall();
                            }}">
                            <ha-icon .icon=${phoneIcon}></ha-icon>
                        </ha-icon-button>
                        ${showHeader ? "" : html`<span>${statusText}</span>`}
                    </div>
                    <div>
                        ${(this.config?.buttons ?? []).map((button) => {
                            if (button.type === ButtonType.SERVICE_CALL) {
                                return html`
                                    <ha-icon-button
                                        class="audio-button"
                                        label="${button.label}"
                                        @click="${() => {
                                            const { domain, service, ...service_data } = button.data;
                                            this.hass.callService(domain, service, service_data);
                                        }}"
                                    >
                                        <ha-icon .icon=${button.icon}></ha-icon>
                                    </ha-icon-button>
                                `;
                            } else if (button.type === ButtonType.DTMF) {
                                return html`
                                    <ha-icon-button
                                        class="audio-button"
                                        label="${button.label}"
                                        @click="${() => {
                                            sipCore.RTCSession?.sendDTMF(button.data);
                                        }}"
                                    >
                                        <ha-icon .icon=${button.icon}></ha-icon>
                                    </ha-icon-button>
                                `;
                            }
                        })}
                    </div>
                    <div>
                        <ha-icon-button
                            class="audio-button"
                            label="Mute audio"
                            ?disabled="${sipCore.RTCSession === null}"
                            @click="${() => {
                                if (sipCore.RTCSession?.isMuted().audio) sipCore.RTCSession?.unmute({ audio: true });
                                else sipCore.RTCSession?.mute({ audio: true });
                                this.requestUpdate();
                            }}">
                            <ha-icon
                                .icon="${
                                    sipCore.RTCSession !== null && sipCore.RTCSession?.isMuted().audio
                                        ? "mdi:microphone-off"
                                        : "mdi:microphone"
                                }"
                            </ha-icon>
                        </ha-icon-button>
                        <ha-icon-button
                            class="audio-button"
                            label="Mute video"
                            style="display: ${sipCore.config?.sip_video ? "block" : "none"}"
                            ?disabled="${sipCore.RTCSession === null}"
                            @click="${() => {
                                if (sipCore.RTCSession?.isMuted().video) sipCore.RTCSession?.unmute({ video: true });
                                else sipCore.RTCSession?.mute({ video: true });
                                this.requestUpdate();
                            }}">
                            <ha-icon
                                .icon="${
                                    sipCore.RTCSession !== null && sipCore.RTCSession?.isMuted().video
                                        ? "mdi:video-off"
                                        : "mdi:video"
                                }"
                            ></ha-icon>
                        </ha-icon-button>
                    </div>
                    <div>
                        ${showHeader ? "" : html`<span style="color: gray">${sipCore.callDuration}</span>`}
                        <ha-icon-button
                            style="color: var(--label-badge-red);"
                            label="End Call"
                            ?disabled="${sipCore.callState === CALLSTATE.IDLE}"
                            @click="${() => sipCore.endCall()}">
                            <ha-icon .icon=${"mdi:phone-off"}></ha-icon>
                        </ha-icon-button>
                    </div>
                </div>
            </ha-card>
        `;
    }
}

window.customCards = window.customCards || [];
window.customCards.push({
    type: "sip-call-card",
    name: "SIP Call Card",
    preview: true,
    description: "Offical SIP Call Card",
});
