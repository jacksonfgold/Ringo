// Sound effects using Web Audio API (no external files needed)

class SoundManager {
  constructor() {
    this.enabled = true
    this.audioContext = null
    this.initAudioContext()
  }

  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
    } catch (e) {
      console.warn('Web Audio API not supported:', e)
      this.enabled = false
    }
  }

  playTone(frequency, duration, type = 'sine', volume = 0.3) {
    if (!this.enabled || !this.audioContext) return

    try {
      const oscillator = this.audioContext.createOscillator()
      const gainNode = this.audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(this.audioContext.destination)

      oscillator.frequency.value = frequency
      oscillator.type = type

      gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration)

      oscillator.start(this.audioContext.currentTime)
      oscillator.stop(this.audioContext.currentTime + duration)
    } catch (e) {
      console.warn('Error playing sound:', e)
    }
  }

  playChord(frequencies, duration, type = 'sine', volume = 0.2) {
    if (!this.enabled || !this.audioContext) return

    frequencies.forEach(freq => {
      this.playTone(freq, duration, type, volume / frequencies.length)
    })
  }

  // Game-specific sounds
  playCardPlay() {
    // Pleasant ascending tone
    this.playTone(440, 0.1, 'sine', 0.2)
    setTimeout(() => this.playTone(523, 0.1, 'sine', 0.2), 50)
  }

  playRINGO() {
    // Exciting ascending chord
    this.playChord([440, 554, 659], 0.3, 'sine', 0.3)
    setTimeout(() => this.playChord([523, 659, 784], 0.3, 'sine', 0.3), 100)
  }

  playDrawCard() {
    // Quick single tone
    this.playTone(330, 0.15, 'sine', 0.2)
  }

  playWin() {
    // Victory fanfare
    this.playTone(523, 0.2, 'sine', 0.3)
    setTimeout(() => this.playTone(659, 0.2, 'sine', 0.3), 150)
    setTimeout(() => this.playTone(784, 0.3, 'sine', 0.3), 300)
    setTimeout(() => this.playTone(1047, 0.4, 'sine', 0.3), 500)
  }

  playTurnNotification() {
    // Gentle notification
    this.playTone(440, 0.2, 'sine', 0.15)
  }

  playInvalidMove() {
    // Low error tone
    this.playTone(220, 0.2, 'sawtooth', 0.2)
  }

  playCardSelect() {
    // Subtle click
    this.playTone(800, 0.05, 'sine', 0.1)
  }

  playCardInsert() {
    // Satisfying drop
    this.playTone(600, 0.1, 'sine', 0.15)
    setTimeout(() => this.playTone(500, 0.1, 'sine', 0.15), 50)
  }

  setEnabled(enabled) {
    this.enabled = enabled
    if (enabled && !this.audioContext) {
      this.initAudioContext()
    }
  }

  toggle() {
    this.setEnabled(!this.enabled)
    return this.enabled
  }
}

// Singleton instance
export const soundManager = new SoundManager()

// Load preference from localStorage
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('ringo_soundEnabled')
  if (saved !== null) {
    soundManager.setEnabled(saved === 'true')
  }
}
