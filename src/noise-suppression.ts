import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

/**
 * Where the RNNoise / AEC3 worklets and WASM binaries are served from.
 * They are copied next to `sip_core.js` at build time and registered as
 * static paths by the integration (see `__init__.py`).
 */
const FILES_BASE = "/sip_core_files";

/** RNNoise and AEC3 both run at 48 kHz. */
const SAMPLE_RATE = 48000;

/** How long to wait for a suspended AudioContext to start before giving up. */
const RESUME_TIMEOUT_MS = 1000;

/** Audio processing options, set in the SIP Core config as `noise_suppression`. */
export interface NoiseSuppressionConfig {
    /** Denoise the local microphone (RNNoise) before it is sent to the other party. */
    microphone?: boolean;
    /** Denoise the audio received from the other party before it is played. */
    remote?: boolean;
    /**
     * Run WebRTC's AEC3 echo canceller in the page (WASM), using the played
     * remote audio as reference. Replaces the browser's / phone's own echo
     * canceller, which is then switched off unless `browser_echo_cancellation`
     * is set explicitly.
     */
    software_echo_cancellation?: boolean;
    /**
     * The browser's own microphone processing (default `true` each, except echo
     * cancellation with `software_echo_cancellation`). On Android these switch on
     * the phone's built-in voice-call effects, which can gate or crackle on
     * speakerphone; set them to `false` to bypass them.
     */
    browser_echo_cancellation?: boolean;
    browser_noise_suppression?: boolean;
    browser_auto_gain?: boolean;
}

/** True when SIP Core must open the microphone itself to apply these options */
export function hasBrowserProcessingOverrides(config?: NoiseSuppressionConfig): boolean {
    return (
        config?.software_echo_cancellation === true ||
        config?.browser_echo_cancellation !== undefined ||
        config?.browser_noise_suppression !== undefined ||
        config?.browser_auto_gain !== undefined
    );
}

/** getUserMedia processing constraints for the config */
export function browserProcessing(config?: NoiseSuppressionConfig) {
    const software = config?.software_echo_cancellation === true;
    return {
        echoCancellation: config?.browser_echo_cancellation ?? !software,
        noiseSuppression: config?.browser_noise_suppression ?? true,
        autoGainControl: config?.browser_auto_gain ?? true,
    };
}

let rnnoiseWasm: Promise<ArrayBuffer> | null = null;

function loadRnnoiseWasm(version: string): Promise<ArrayBuffer> {
    if (rnnoiseWasm === null) {
        rnnoiseWasm = loadRnnoise({
            url: `${FILES_BASE}/rnnoise.wasm?v=${version}`,
            simdUrl: `${FILES_BASE}/rnnoise_simd.wasm?v=${version}`,
        }).catch((err) => {
            // Allow a retry on the next call instead of caching the failure.
            rnnoiseWasm = null;
            throw err;
        });
    }
    return rnnoiseWasm;
}

let aecModule: Promise<WebAssembly.Module> | null = null;

function loadAecModule(version: string): Promise<WebAssembly.Module> {
    if (aecModule === null) {
        aecModule = fetch(`${FILES_BASE}/webrtc-apm.wasm?v=${version}`)
            .then((resp) => {
                if (!resp.ok) throw new Error(`webrtc-apm.wasm: HTTP ${resp.status}`);
                return resp.arrayBuffer();
            })
            .then((bytes) => WebAssembly.compile(bytes))
            .catch((err) => {
                aecModule = null;
                throw err;
            });
    }
    return aecModule;
}

async function resumeContext(ctx: AudioContext): Promise<void> {
    if (ctx.state === "running") return;
    // `resume()` stays pending until a user gesture when autoplay is blocked
    // (e.g. auto answer or `?call=` without a click), so don't wait forever.
    await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
    if ((ctx.state as AudioContextState) !== "running") {
        throw new Error(`AudioContext is ${ctx.state} (autoplay blocked?)`);
    }
}

export interface ChainOptions {
    /** `true` for a WebRTC receive stream (see `create`) */
    remote?: boolean;
    /** Run RNNoise (default `true`) */
    denoise?: boolean;
    /** Run AEC3; feed it the played audio with `setEchoReference()` */
    echoCancel?: boolean;
}

/** Latest AEC3 statistics, as reported by the worklet about every 5 s */
export interface AecStats {
    delayMs: number | null;
    erleDb: number | null;
    erlDb: number | null;
    referenceShort: number;
}

/**
 * Runs the audio of a MediaStream through AEC3 and/or RNNoise:
 * input → [AEC3 (+ reference)] → [RNNoise] → `stream`.
 *
 * `stream` holds the processed audio track plus any video tracks of the input.
 * The input stream is not owned: `close()` releases the processing graph but
 * leaves the input tracks running, the caller stops them.
 */
export class DenoisedStream {
    readonly stream: MediaStream;
    /** Latest AEC3 statistics, `null` until the worklet reports */
    aecStats: AecStats | null = null;

    private referenceSource: MediaStreamAudioSourceNode | null = null;
    private referenceStream: MediaStream | null = null;

    private constructor(
        stream: MediaStream,
        private ctx: AudioContext,
        private rnnoise: RnnoiseWorkletNode | null,
        private aec: AudioWorkletNode | null,
        private keepAlive: HTMLAudioElement | null,
    ) {
        this.stream = stream;
        if (aec) {
            aec.port.onmessage = (event: MessageEvent) => {
                const msg = event.data;
                if (msg?.type === "stats") {
                    this.aecStats = msg.stats;
                    const s = msg.stats;
                    console.info(
                        `SIP Core AEC3: echo delay ${s.delayMs ?? "?"} ms, echo reduced by ${
                            s.erleDb !== null ? s.erleDb.toFixed(1) : "?"
                        } dB (ERLE), reference gaps ${s.referenceShort} samples`,
                    );
                } else if (msg?.type === "error") {
                    console.warn("SIP Core AEC3 failed to start, passing the microphone through:", msg.message);
                }
            };
        }
    }

    /**
     * @param input stream whose first audio track is processed
     * @param version SIP Core version, used to bust the static file cache
     * @param options which stages to run. With `remote`, the input is a WebRTC
     *   receive stream: Chrome only feeds those into Web Audio while they are
     *   also attached to a media element, so a muted one is kept playing alongside.
     */
    static async create(input: MediaStream, version: string, options: ChainOptions = {}): Promise<DenoisedStream> {
        const denoise = options.denoise !== false;
        const echoCancel = options.echoCancel === true;
        if (input.getAudioTracks().length === 0) {
            throw new Error("Stream has no audio track");
        }
        if (!denoise && !echoCancel) {
            throw new Error("Nothing to do: neither denoise nor echoCancel");
        }

        let keepAlive: HTMLAudioElement | null = null;
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        try {
            if (options.remote) {
                keepAlive = new Audio();
                keepAlive.muted = true;
                keepAlive.srcObject = input;
                keepAlive.play().catch(() => {
                    /* muted playback is best effort */
                });
            }

            const [rnnoiseBinary, aecWasm] = await Promise.all([
                denoise ? loadRnnoiseWasm(version) : Promise.resolve(null),
                echoCancel ? loadAecModule(version) : Promise.resolve(null),
                denoise ? ctx.audioWorklet.addModule(`${FILES_BASE}/rnnoise-worklet.js?v=${version}`) : null,
                echoCancel ? ctx.audioWorklet.addModule(`${FILES_BASE}/aec-worklet.js?v=${version}`) : null,
            ]);

            let node: AudioNode = ctx.createMediaStreamSource(new MediaStream(input.getAudioTracks()));

            let aec: AudioWorkletNode | null = null;
            if (echoCancel && aecWasm) {
                aec = new AudioWorkletNode(ctx, "sipcore-aec", {
                    numberOfInputs: 2,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                    // Downmix mic and reference to mono each
                    channelCount: 1,
                    channelCountMode: "explicit",
                    channelInterpretation: "speakers",
                    processorOptions: { module: aecWasm },
                });
                node.connect(aec, 0, 0);
                node = aec;
            }

            let rnnoise: RnnoiseWorkletNode | null = null;
            if (denoise && rnnoiseBinary) {
                rnnoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: rnnoiseBinary });
                // Voice is mono: downmix so RNNoise only runs once per frame.
                rnnoise.channelCount = 1;
                rnnoise.channelCountMode = "explicit";
                rnnoise.channelInterpretation = "speakers";
                node.connect(rnnoise);
                node = rnnoise;
            }

            const destination = ctx.createMediaStreamDestination();
            node.connect(destination);

            await resumeContext(ctx);

            const output = new MediaStream([...destination.stream.getAudioTracks(), ...input.getVideoTracks()]);
            const stages = [aec ? "AEC3 echo cancellation" : "", rnnoise ? "RNNoise" : ""].filter(Boolean).join(" + ");
            console.info(`SIP Core: ${stages} enabled for ${options.remote ? "remote" : "microphone"} audio`);
            return new DenoisedStream(output, ctx, rnnoise, aec, keepAlive);
        } catch (err) {
            ctx.close().catch(() => {});
            if (keepAlive) keepAlive.srcObject = null;
            throw err;
        }
    }

    /** Whether this chain runs AEC3 and therefore wants an echo reference */
    get echoCancelling(): boolean {
        return this.aec !== null;
    }

    /**
     * Sets the audio that AEC3 removes from the microphone: the stream that is
     * actually played on the speaker. `null` disconnects it.
     */
    setEchoReference(stream: MediaStream | null): void {
        if (!this.aec || stream === this.referenceStream) return;
        this.referenceSource?.disconnect();
        this.referenceSource = null;
        this.referenceStream = stream;
        if (stream && stream.getAudioTracks().length > 0) {
            this.referenceSource = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
            this.referenceSource.connect(this.aec, 0, 1);
            console.info("SIP Core AEC3: echo reference connected");
        }
    }

    close(): void {
        this.stream.getAudioTracks().forEach((track) => track.stop());
        this.referenceSource?.disconnect();
        try {
            this.rnnoise?.destroy();
        } catch (err) {
            console.debug("SIP Core: error destroying RNNoise node:", err);
        }
        this.aec?.port.postMessage("destroy");
        this.ctx.close().catch(() => {});
        if (this.keepAlive) {
            this.keepAlive.pause();
            this.keepAlive.srcObject = null;
        }
    }
}
