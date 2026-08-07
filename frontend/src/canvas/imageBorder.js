export const AUTO_IMAGE_BORDER = '__s8_auto_image_border__'

export function normalizeImageBorderColor(value) {
  return typeof value === 'string' && value.trim() ? value : AUTO_IMAGE_BORDER
}
