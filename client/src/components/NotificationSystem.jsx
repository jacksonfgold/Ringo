import { useState, useEffect } from 'react'

export function NotificationSystem({ socket }) {
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    if (!socket) return

    const handleNotification = (data) => {
      const notification = {
        id: Date.now() + Math.random(),
        type: data.type || 'info',
        message: data.message,
        playerName: data.playerName,
        cardInfo: data.cardInfo,
        timestamp: Date.now()
      }
      
      setNotifications(prev => [...prev, notification])
      
      // Auto-remove after 4 seconds
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== notification.id))
      }, 4000)
    }

    socket.on('playerNotification', handleNotification)

    return () => {
      socket.off('playerNotification', handleNotification)
    }
  }, [socket])

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div style={styles.container}>
      {notifications.map(notification => (
        <div
          key={notification.id}
          style={{
            ...styles.notification,
            ...(notification.type === 'ringo' ? styles.ringoNotification : {}),
            ...(notification.type === 'play' ? styles.playNotification : {}),
            ...(notification.type === 'draw' ? styles.drawNotification : {})
          }}
          onClick={() => removeNotification(notification.id)}
        >
          <div style={styles.content}>
            <div style={styles.playerName}>{notification.playerName}</div>
            <div style={styles.message}>{notification.message}</div>
            {notification.cardInfo && (
              <div style={styles.cardInfo}>
                {notification.cardInfo.map((card, idx) => (
                  <span
                    key={idx}
                    style={{
                      ...styles.cardBadge,
                      background: card.isSplit
                        ? `linear-gradient(to right, ${getCardColor(card.splitValues[0])} 0%, ${getCardColor(card.splitValues[0])} 50%, ${getCardColor(card.splitValues[1])} 50%, ${getCardColor(card.splitValues[1])} 100%)`
                        : getCardColor(card.value)
                    }}
                  >
                    {card.isSplit ? `${card.splitValues[0]}/${card.splitValues[1]}` : card.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

const getCardColor = (value) => {
  const colors = {
    1: '#C0392B',
    2: '#16A085',
    3: '#2980B9',
    4: '#E67E22',
    5: '#27AE60',
    6: '#F39C12',
    7: '#8E44AD',
    8: '#34495E'
  }
  return colors[value] || '#7F8C8D'
}

const styles = {
  container: {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxWidth: 'calc(100vw - 32px)',
    width: 'min(320px, calc(100vw - 32px))',
    pointerEvents: 'none',
    alignItems: 'flex-end'
  },
  notification: {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(10px)',
    borderRadius: '12px',
    padding: '12px 16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    pointerEvents: 'auto',
    cursor: 'pointer',
    animation: 'slideIn 0.3s ease-out',
    transition: 'opacity 0.2s, transform 0.2s',
    maxWidth: '100%',
    minWidth: 'min(280px, calc(100vw - 32px))',
    width: '100%'
  },
  ringoNotification: {
    background: 'linear-gradient(135deg, rgba(255, 107, 107, 0.95) 0%, rgba(238, 82, 83, 0.95) 100%)',
    color: 'white',
    border: '2px solid rgba(255,255,255,0.5)',
    boxShadow: '0 4px 20px rgba(255, 107, 107, 0.4)'
  },
  playNotification: {
    background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%)',
    color: 'white',
    border: '2px solid rgba(255,255,255,0.5)'
  },
  drawNotification: {
    background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.95) 0%, rgba(69, 160, 73, 0.95) 100%)',
    color: 'white',
    border: '2px solid rgba(255,255,255,0.5)'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  playerName: {
    fontSize: '12px',
    fontWeight: '700',
    opacity: 0.9,
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  message: {
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '1.4'
  },
  cardInfo: {
    display: 'flex',
    gap: '6px',
    marginTop: '6px',
    flexWrap: 'wrap'
  },
  cardBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '28px',
    height: '28px',
    borderRadius: '6px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '800',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.3)'
  }
}
