export class SoundEngine {
  constructor() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.isMuted = true;
    this.bgmOscillators = [];
    this.isPlayingBGM = false;
    this.bgmGainNode = this.audioCtx.createGain();
    this.bgmGainNode.gain.value = 0;
    this.bgmGainNode.connect(this.audioCtx.destination);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.bgmGainNode.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.5);
    } else {
      if (!this.isPlayingBGM) {
        this.startBGM();
      }
      this.bgmGainNode.gain.setTargetAtTime(0.15, this.audioCtx.currentTime, 0.5);
    }
    return this.isMuted;
  }

  // Synthwave Ambient Background Music (Procedural)
  startBGM() {
    if (this.isPlayingBGM) return;
    this.isPlayingBGM = true;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    if (!this.isMuted) {
      this.bgmGainNode.gain.setValueAtTime(0.01, this.audioCtx.currentTime);
      this.bgmGainNode.gain.linearRampToValueAtTime(0.15, this.audioCtx.currentTime + 3);
    }

    const chords = [
      [130.81, 155.56, 196.00], // C Minor
      [146.83, 174.61, 220.00], // D Minor
      [116.54, 138.59, 174.61], // Bb Minor
      [103.83, 123.47, 155.56]  // Ab Major
    ];

    let chordIndex = 0;
    const playChord = () => {
      if (!this.isPlayingBGM) return;

      this.bgmOscillators.forEach(osc => {
        try { osc.stop(); } catch (e) {}
      });
      this.bgmOscillators = [];

      const currentChord = chords[chordIndex];

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, this.audioCtx.currentTime);
      filter.frequency.linearRampToValueAtTime(1200, this.audioCtx.currentTime + 2);
      filter.connect(this.bgmGainNode);

      // El filtro del acorde en curso queda accesible para `setTension`: es el que
      // se abre cuando el fantasma se acerca.
      this.bgmFilter = filter;

      currentChord.forEach(freq => {
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.connect(filter);
        osc.start();
        this.bgmOscillators.push(osc);
      });

      chordIndex = (chordIndex + 1) % chords.length;
      this.bgmTimeout = setTimeout(playChord, 4000); // Change chord every 4s
    };

    playChord();
  }

  /**
   * Tensión de la música según lo cerca que esté el fantasma.
   *
   * Antes el acompañamiento era el mismo ciclo de acordes pasara lo que pasara, y
   * la única pista de que te estaban alcanzando era mirar a la pantalla. Con el
   * filtro abriéndose y el volumen subiendo, la amenaza se oye llegar.
   *
   * @param {number} tension de 0 (lejos) a 1 (encima)
   */
  setTension(tension) {
    if (this.isMuted || !this.isPlayingBGM) return;

    const clamped = Math.max(0, Math.min(1, tension || 0));
    const now = this.audioCtx.currentTime;

    // `setTargetAtTime` en vez de asignación directa: un salto de filtro se oye
    // como un chasquido.
    if (this.bgmFilter) {
      this.bgmFilter.frequency.setTargetAtTime(700 + clamped * 2600, now, 0.35);
    }
    this.bgmGainNode.gain.setTargetAtTime(0.15 + clamped * 0.12, now, 0.4);
  }

  /** Ahoga la música al pausar, sin cortarla. */
  setMuffled(muffled) {
    if (!this.bgmFilter || this.isMuted) return;
    this.bgmFilter.frequency.setTargetAtTime(muffled ? 220 : 1200, this.audioCtx.currentTime, 0.15);
  }

  stopBGM() {
    this.isPlayingBGM = false;
    this.bgmFilter = null;
    clearTimeout(this.bgmTimeout);
    this.bgmGainNode.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.5);
    setTimeout(() => {
      this.bgmOscillators.forEach(osc => {
        try { osc.stop(); } catch (e) {}
      });
      this.bgmOscillators = [];
    }, 1000);
  }

  // SFX: Pressure Plate Trigger
  playPlateTrigger() {
    if (this.isMuted) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.2);
  }

  // SFX: Door Unlock
  playUnlock() {
    if (this.isMuted) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.audioCtx.currentTime + 0.5);
    osc.frequency.exponentialRampToValueAtTime(1760, this.audioCtx.currentTime + 1.0);
    
    gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, this.audioCtx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 1.2);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start();
    osc.stop(this.audioCtx.currentTime + 1.2);
  }

  // SFX: Ghost Damage
  playDamage() {
    if (this.isMuted) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.audioCtx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.3);
  }

  // SFX: UI Click
  playClick() {
    if (this.isMuted) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.1);
  }
}
