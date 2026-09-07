/**
 * VoxAct — Voice Visualizer
 * Canvas-based audio waveform visualization and orb state management.
 */

class VoiceVisualizer {
  constructor(canvasElement, orbContainer) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.orbContainer = orbContainer;
    this.analyser = null;
    this.dataArray = null;
    this.animationFrame = null;
    this.state = 'idle';
    this.isRunning = false;

    // Particle system for ambient effect
    this.particles = [];
    this.initParticles();

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  /**
   * Resize canvas to match container
   */
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  /**
   * Initialize particles for ambient effect
   */
  initParticles() {
    this.particles = [];
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: Math.random() * 200,
        y: Math.random() * 40,
        radius: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.5 + 0.2,
        opacity: Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * Connect to an audio stream for visualization
   */
  connectStream(stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    source.connect(this.analyser);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /**
   * Set the visual state
   */
  setState(state) {
    this.state = state;

    // Update orb container class
    this.orbContainer.className = 'orb-container';
    if (state !== 'idle') {
      this.orbContainer.classList.add(state);
    }
  }

  /**
   * Start the visualization loop
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._draw();
  }

  /**
   * Stop the visualization loop
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Main draw loop
   */
  _draw() {
    if (!this.isRunning) return;

    this.ctx.clearRect(0, 0, this.width, this.height);

    // Get audio data if available
    let audioLevel = 0;
    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      const sum = this.dataArray.reduce((a, b) => a + b, 0);
      audioLevel = sum / this.dataArray.length / 255;
    }

    // Draw based on state
    switch (this.state) {
      case 'listening':
        this._drawListeningWave(audioLevel);
        break;
      case 'processing':
      case 'tool_work':
        this._drawProcessingWave();
        break;
      case 'speaking':
        this._drawSpeakingWave();
        break;
      default:
        this._drawIdleWave();
    }

    this.animationFrame = requestAnimationFrame(() => this._draw());
  }

  /**
   * Idle state — subtle ambient dots
   */
  _drawIdleWave() {
    const time = Date.now() / 2000;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    this.particles.forEach(p => {
      const x = p.x + Math.sin(time + p.phase) * 3;
      const y = p.y + Math.cos(time + p.phase) * 2;
      const opacity = (Math.sin(time + p.phase) * 0.5 + 0.5) * 0.2;

      this.ctx.beginPath();
      this.ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(0, 212, 170, ${opacity})`;
      this.ctx.fill();
    });
  }

  /**
   * Listening state — reactive waveform based on microphone input
   */
  _drawListeningWave(audioLevel) {
    const time = Date.now() / 1000;
    const centerY = this.height / 2;
    const barCount = 32;
    const barWidth = this.width / barCount - 1;
    const maxHeight = this.height * 0.8;

    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + 1);
      const dataIndex = Math.floor(i * (this.dataArray ? this.dataArray.length : 1) / barCount);
      const value = this.dataArray ? this.dataArray[dataIndex] / 255 : 0;
      const height = Math.max(2, value * maxHeight * 0.6 + Math.sin(time * 3 + i * 0.3) * 3);

      const gradient = this.ctx.createLinearGradient(x, centerY - height / 2, x, centerY + height / 2);
      gradient.addColorStop(0, `rgba(0, 212, 170, ${0.3 + value * 0.5})`);
      gradient.addColorStop(1, `rgba(0, 212, 170, 0.05)`);

      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(x, centerY - height / 2, barWidth, height);
    }
  }

  /**
   * Processing state — rotating dots
   */
  _drawProcessingWave() {
    const time = Date.now() / 800;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + time;
      const radius = 15 + Math.sin(time * 2 + i) * 5;
      const x = centerX + Math.cos(angle) * radius * 3;
      const y = centerY + Math.sin(angle) * radius * 0.5;
      const opacity = (Math.sin(time + i * 0.8) * 0.5 + 0.5) * 0.6 + 0.2;
      const dotRadius = 2 + Math.sin(time + i) * 1;

      this.ctx.beginPath();
      this.ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255, 159, 67, ${opacity})`;
      this.ctx.fill();
    }
  }

  /**
   * Speaking state — smooth sine wave
   */
  _drawSpeakingWave() {
    const time = Date.now() / 500;
    const centerY = this.height / 2;

    this.ctx.beginPath();
    this.ctx.moveTo(0, centerY);

    for (let x = 0; x < this.width; x++) {
      const y = centerY +
        Math.sin(x * 0.03 + time) * 6 +
        Math.sin(x * 0.05 + time * 1.3) * 4 +
        Math.sin(x * 0.08 + time * 0.7) * 2;
      this.ctx.lineTo(x, y);
    }

    this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Second wave (overlay)
    this.ctx.beginPath();
    this.ctx.moveTo(0, centerY);
    for (let x = 0; x < this.width; x++) {
      const y = centerY +
        Math.sin(x * 0.04 + time * 1.5) * 4 +
        Math.sin(x * 0.06 + time * 0.8) * 3;
      this.ctx.lineTo(x, y);
    }
    this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
  }

  /**
   * Clean up
   */
  destroy() {
    this.stop();
  }
}

// Make globally available
window.VoiceVisualizer = VoiceVisualizer;
