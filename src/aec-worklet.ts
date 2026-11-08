/**
 * AudioWorklet running WebRTC's AEC3 echo canceller
 * (@ai-ecoverse/wasm-webrtc-audio-processing).
 *
 * Input 0: microphone. Input 1: reference, i.e. the remote audio being played
 * on the speaker. Output: the microphone with the reference's echo removed.
 * Built as its own bundle (`aec-worklet.js`) and loaded with
 * `audioWorklet.addModule()`; the compiled WASM module is passed in through
 * `processorOptions.module`.
 */
import { instantiate, EchoCanceller } from "@ai-ecoverse/wasm-webrtc-audio-processing";

// Minimal AudioWorkletGlobalScope typings (not part of the DOM lib)
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: any): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor(options?: any);
}

/** Post statistics about every 5 seconds (in 128-sample render quanta) */
const STATS_EVERY = Math.round((5 * 48000) / 128);

class SipCoreAecProcessor extends AudioWorkletProcessor {
    private aec: EchoCanceller | null = null;
    private silence = new Float32Array(128);
    private quanta = 0;

    constructor(options: any) {
        super(options);
        try {
            this.aec = instantiate(options.processorOptions.module).create({ sampleRate: sampleRate as 48000 });
            this.port.postMessage({ type: "ready", latencySamples: this.aec.latencySamples });
        } catch (err) {
            this.port.postMessage({ type: "error", message: String(err) });
        }
        this.port.onmessage = (event: MessageEvent) => {
            if (event.data === "destroy" && this.aec) {
                this.aec.destroy();
                this.aec = null;
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const out = outputs[0]?.[0];
        if (!out) return true;
        const mic = inputs[0]?.[0];
        if (!mic) {
            out.fill(0);
            return true;
        }
        if (!this.aec) {
            // Pass the mic through rather than going silent if AEC3 failed to start
            out.set(mic);
            return true;
        }
        let ref = inputs[1]?.[0];
        if (!ref || ref.length !== mic.length) {
            if (this.silence.length !== mic.length) this.silence = new Float32Array(mic.length);
            ref = this.silence;
        }
        this.aec.cancel(mic, ref, out);

        if (++this.quanta >= STATS_EVERY) {
            this.quanta = 0;
            this.port.postMessage({ type: "stats", stats: this.aec.stats() });
        }
        return true;
    }
}

registerProcessor("sipcore-aec", SipCoreAecProcessor);
