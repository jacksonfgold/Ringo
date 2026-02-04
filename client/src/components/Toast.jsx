import { useState, useEffect } from 'react'

let toastIdCounter = 0
const toastListeners = new Set()

export function showToast(message, type = 'info', duration = 3000) {
  const id = toastIdCounter++
  const toast = { id, message, type, duration }
  
  toastListeners.forEach(listener => listener(toast))
  
  return id
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const listener = (toast) => {
      setToasts(prev => [...prev, toast])
      
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id))
      }, toast.duration)
    }
    
    toastListeners.add(listener)
    
    return () => {
      toastListeners.delete(listener)
    }
  }, [])

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div style={styles.container}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{
            ...styles.toast,
            ...(toast.type === 'error' ? styles.errorToast : {}),
            ...(toast.type === 'success' ? styles.successToast : {}),
            ...(toast.type === 'warning' ? styles.warningToast : {})
          }}
          onClick={() => removeToast(toast.id)}
        >
          <div style={styles.content}>
            {toast.type === 'error' && '❌ '}
            {toast.type === 'success' && '✓ '}
            {toast.type === 'warning' && '⚠️ '}
            {toast.message}
          </div>
        </div>
      ))}
    </div>
  )
}

const styles = {
  container: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10000,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
    pointerEvents: 'none',
    maxWidth: 'calc(100vw - 40px)',
    width: 'auto'
  },
  toast: {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(10px)',
    borderRadius: '12px',
    padding: '14px 20px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    pointerEvents: 'auto',
    cursor: 'pointer',
    animation: 'slideUpToast 0.3s ease-out',
    minWidth: '280px',
    maxWidth: '400px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333'
  },
  errorToast: {
    background: 'rgba(255, 107, 107, 0.95)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.3)'
  },
  successToast: {
    background: 'rgba(46, 204, 113, 0.95)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.3)'
  },
  warningToast: {
    background: 'rgba(255, 193, 7, 0.95)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.3)'
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }
}
