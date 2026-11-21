// Prints one section of the page: every element outside the section's ancestor
// chain is hidden for the print, then restored. Wide reports can print landscape.
export function printSection(section: HTMLElement | null, { landscape = false, thermal = false } = {}) {
  if (!section) return window.print()
  const hidden: Element[] = []
  for (let node: HTMLElement | null = section; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling !== node && !sibling.classList.contains('print-hidden')) { sibling.classList.add('print-hidden'); hidden.push(sibling) }
    }
  }
  const orientation = document.createElement('style')
  // Thermal tickets: 80 mm roll, height following the content (72 mm printable width).
  orientation.textContent = thermal
    ? '@page { size: 80mm auto; margin: 2mm 4mm; } @media print { html, body { width: 72mm; min-width: 0 !important; } }'
    : `@page { size: letter ${landscape ? 'landscape' : 'portrait'}; margin: 0.45in; }`
  document.head.appendChild(orientation)
  const restore = () => { hidden.forEach((element) => element.classList.remove('print-hidden')); orientation.remove(); window.removeEventListener('afterprint', restore) }
  window.addEventListener('afterprint', restore)
  window.print()
}
