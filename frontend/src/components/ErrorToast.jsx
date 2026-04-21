import { useEffect } from 'react'
import './ErrorToast.css'

export default function ErrorToast({ message, visible, onDismiss }) {
  useEffect(() => {
    if (!visible || !message) return

    const timer = setTimeout(() => {
      onDismiss()
    }, 3000)

    return () => clearTimeout(timer)
  }, [visible, message, onDismiss])

  if (!visible || !message) return null

  return (
    <div className="error-toast" onClick={onDismiss}>
      {message}
    </div>
  )
}
