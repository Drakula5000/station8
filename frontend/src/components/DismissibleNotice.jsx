import { useState } from 'react'

export function DismissibleNotice({ className = '', children, ...props }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div className={`${className} station-notice`.trim()} {...props}>
      {children}
      <button
        className="station-notice-dismiss"
        type="button"
        aria-label="Dismiss notice"
        title="Dismiss"
        onClick={() => setDismissed(true)}
      >×</button>
    </div>
  )
}
