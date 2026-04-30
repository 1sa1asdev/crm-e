import { useRef, useEffect, useLayoutEffect } from 'react'

export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open) { if (!d.open) d.showModal() }
    else       { if (d.open)  d.close()    }
  }, [open])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    d.addEventListener('close', onClose)
    return () => d.removeEventListener('close', onClose)
  }, [onClose])

  return ref
}
