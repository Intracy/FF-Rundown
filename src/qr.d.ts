// Typen für den QR-Encoder aus FF Rundown (qr.js)
export function qrMatrix(text: string, ecl?: 'L' | 'M' | 'Q' | 'H'): boolean[][];
export function qrSvg(text: string, opts?: { border?: number; dark?: string; light?: string; ecl?: 'L' | 'M' | 'Q' | 'H' }): string;
export function qrPng(text: string, opts?: { scale?: number; border?: number; ecl?: 'L' | 'M' | 'Q' | 'H' }): string;
