class TrueFaceVoiceToneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "semitones", defaultValue: 0, minValue: -4, maxValue: 4 }];
  }

  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.writeIndex = 0;
    this.readIndex = 2048;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !output.length) return true;
    const semitones = parameters.semitones;
    const shift = Math.pow(2, (semitones.length ? semitones[0] : 0) / 12);
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[Math.min(channel, input.length - 1)];
      const target = output[channel];
      for (let index = 0; index < target.length; index += 1) {
        this.buffer[this.writeIndex] = source?.[index] ?? 0;
        const lower = Math.floor(this.readIndex) % this.buffer.length;
        const upper = (lower + 1) % this.buffer.length;
        const fraction = this.readIndex - Math.floor(this.readIndex);
        target[index] =
          this.buffer[lower] * (1 - fraction) + this.buffer[upper] * fraction;
        this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
        this.readIndex = (this.readIndex + shift) % this.buffer.length;
        const distance =
          (this.writeIndex - this.readIndex + this.buffer.length) % this.buffer.length;
        if (distance < 512 || distance > 3584) {
          this.readIndex = (this.writeIndex + 2048) % this.buffer.length;
        }
      }
    }
    return true;
  }
}

registerProcessor("trueface-voice-tone", TrueFaceVoiceToneProcessor);
