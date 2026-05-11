import { createElement, Fragment } from 'react'
import { GeoShapeUtil } from 'tldraw'
import { hasCustomFill, resolveFillColor } from './magicFill'

// Geo shapes carrying a custom fill (via shape.meta.fillColor + fillOpacity)
// don't honour that fill in exports out of the box — tldraw's GeoShapeUtil
// renders SVG from shape.props only, ignoring meta. On canvas we paper over
// that with a CSS variable (see tldraw.css `data-geo-fill-custom='true']`),
// but the variable doesn't reach editor.toImage / getSvgString.
//
// Override: when a shape has a custom fill, draw our own filled <path> under
// super.toSvg's output and suppress tldraw's default fill by passing
// `props.fill: 'none'` to super. The fill path follows the shape's geometry
// vertices, which are a polyline approximation for curved shapes (ellipse,
// cloud, star) — close enough for export at typical resolutions, and the
// stroke that super still draws traces the exact same vertices.
export class StationGeoShapeUtil extends GeoShapeUtil {
  toSvg(shape, ctx) {
    if (!hasCustomFill(shape)) return super.toSvg(shape, ctx)

    const fillColor = resolveFillColor(shape.meta.fillColor, ctx.isDarkMode)
    const fillOpacity = Number(shape.meta.fillOpacity)

    const geometry = this.editor.getShapeGeometry(shape)
    const verts = geometry?.vertices ?? []
    if (verts.length === 0) return super.toSvg(shape, ctx)
    const d = verts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'

    const shapeWithoutFill = { ...shape, props: { ...shape.props, fill: 'none' } }
    return createElement(
      Fragment,
      null,
      createElement('path', { d, fill: fillColor, fillOpacity, stroke: 'none' }),
      super.toSvg(shapeWithoutFill, ctx)
    )
  }
}
