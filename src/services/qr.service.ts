import { Injectable } from '@angular/core';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

export interface QrBetData {
    v: number; // version
    d: [string, number][]; // data [number, amount][]
    a?: string; // agentName (optional)
}

@Injectable({ providedIn: 'root' })
export class QrService {
  
  // --- Compression Logic ---
  // V2 Format: "V2|AgentName|12:100,34:200,55:500"
  private compressData(data: QrBetData): string {
      const agent = data.a || '';
      const body = data.d.map(item => `${item[0]}:${item[1]}`).join(',');
      return `V2|${agent}|${body}`;
  }

  // Restore V2 Format back to JSON Object for the app to use
  private decompressData(compressed: string): QrBetData | null {
      try {
          const parts = compressed.split('|');
          if (parts.length < 3) return null;

          const agent = parts[1];
          const body = parts[2];
          
          if (!body) return { v: 1, d: [], a: agent };

          const items = body.split(',').map(pair => {
              const [num, amtStr] = pair.split(':');
              return [num, parseInt(amtStr, 10)] as [string, number];
          });

          return {
              v: 1, // Return as v1 format so components can parse it normally
              d: items,
              a: agent
          };
      } catch (e) {
          console.error("Decompression failed", e);
          return null;
      }
  }

  async generateQrCode(data: QrBetData): Promise<string> {
    try {
      // Use Compressed Format (V2) instead of JSON string
      const compressedString = this.compressData(data);
      
      return await QRCode.toDataURL(compressedString, {
        errorCorrectionLevel: 'L', // Keep Low for maximum capacity
        margin: 1,
        scale: 8, // Increased scale for high resolution source
      });
    } catch (err) {
      console.error('QR Code generation failed', err);
      return '';
    }
  }

  scanQrCodeFromBlob(imageBlob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) {
            resolve(null);
            return;
          }
          
          // Ensure we work with sufficient resolution
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Draw image
          context.drawImage(img, 0, 0);

          try {
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (code && code.data) {
                // Check if it's our new V2 compressed format
                if (code.data.startsWith('V2|')) {
                    const decompressed = this.decompressData(code.data);
                    if (decompressed) {
                        // Return as JSON string because the components expect a JSON string
                        resolve(JSON.stringify(decompressed));
                        return;
                    }
                }
                // Fallback: Return original data (Assuming it's legacy JSON)
                resolve(code.data);
            } else {
                resolve(null);
            }
          } catch (error) {
            console.error("Error reading QR code from canvas:", error);
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(imageBlob);
    });
  }
}