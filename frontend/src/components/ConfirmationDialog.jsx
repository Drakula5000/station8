import { useEffect } from 'react'
import { CloseIcon } from '../icons'
import './ConfirmationDialog.css'

export default function ConfirmationDialog({ open, onClose, onConfirm, itemType, itemName, consequences }) {
  useEffect(() => {
    if (!open) return

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} type="button">
          <CloseIcon />
        </button>
        
        <h2 className="modal-title">Delete {itemType}?</h2>
        
        <div className="confirm-item-name">{itemName}</div>
        
        <div className="confirm-consequences">{consequences}</div>
        
        <div className="confirm-actions">
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} type="button">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
