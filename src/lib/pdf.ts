import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

/** Area of a page as fractions of its width and height (0–1). */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Layout of a HelloFresh card as scanned by the ScanSnap (landscape, two pages).
 * Measured on card 52 (Nov 2026); the cards share one layout, the margins absorb small scan offsets.
 */
export const LAYOUT = {
  hero: { x0: 0.01, y0: 0.19, x1: 0.785, y1: 0.99 } as Box,
  ingredients: { x0: 0, y0: 0, x1: 0.238, y1: 1 } as Box,
  steps: [
    { x0: 0.247, y0: 0.02, x1: 0.497, y1: 0.45 },
    { x0: 0.497, y0: 0.02, x1: 0.747, y1: 0.45 },
    { x0: 0.745, y0: 0.02, x1: 0.995, y1: 0.45 },
    { x0: 0.247, y0: 0.455, x1: 0.497, y1: 0.89 },
    { x0: 0.497, y0: 0.455, x1: 0.747, y1: 0.89 },
    { x0: 0.745, y0: 0.455, x1: 0.995, y1: 0.89 },
  ] as Box[],
}

/** Renders every page of a PDF to a canvas (about 144 dpi for an A4-landscape card). */
export async function renderPdfPages(file: Blob, scale = 2): Promise<HTMLCanvasElement[]> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  const pages: HTMLCanvasElement[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    pages.push(canvas)
  }
  await task.destroy()
  return pages
}

export function crop(source: HTMLCanvasElement, box: Box): HTMLCanvasElement {
  const sx = Math.round(box.x0 * source.width)
  const sy = Math.round(box.y0 * source.height)
  const w = Math.round((box.x1 - box.x0) * source.width)
  const h = Math.round((box.y1 - box.y0) * source.height)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')!.drawImage(source, sx, sy, w, h, 0, 0, w, h)
  return out
}

export function toJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG-Umwandlung fehlgeschlagen'))), 'image/jpeg', quality),
  )
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
