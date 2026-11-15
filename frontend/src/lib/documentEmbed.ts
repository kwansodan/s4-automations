/**
 * Document embedding utility functions for in-app slip and document preview.
 * Converts external storage links (Google Drive, OneDrive, etc.) into clean
 * embedded preview URLs for iframes and image elements.
 */

export interface ResolvedDocumentEmbed {
  rawUrl: string;
  embedUrl: string;
  isImage: boolean;
  isPdf: boolean;
  canEmbed: boolean;
  sourceType: 'google_drive' | 'onedrive' | 'image' | 'pdf' | 'generic';
}

/**
 * Parses and formats a Google Drive link into the clean iframe preview URL.
 * Google Drive file links in the form of:
 * - https://drive.google.com/file/d/{fileId}/view...
 * - https://drive.google.com/open?id={fileId}
 * - https://drive.google.com/uc?id={fileId}
 * are converted to https://drive.google.com/file/d/{fileId}/preview
 */
export function formatGoogleDrivePreviewUrl(url: string): string | null {
  if (!url) return null;

  // Pattern 1: /file/d/{id}
  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch && fileIdMatch[1]) {
    return `https://drive.google.com/file/d/${fileIdMatch[1]}/preview`;
  }

  // Pattern 2: id={id}
  const queryIdMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryIdMatch && queryIdMatch[1]) {
    return `https://drive.google.com/file/d/${queryIdMatch[1]}/preview`;
  }

  // Pattern 3: already a preview link
  if (url.includes('/preview')) {
    return url;
  }

  return null;
}

/**
 * Checks whether a given URL points directly to an image asset.
 */
export function isImageUrl(url: string): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return (
    clean.endsWith('.png') ||
    clean.endsWith('.jpg') ||
    clean.endsWith('.jpeg') ||
    clean.endsWith('.webp') ||
    clean.endsWith('.gif') ||
    clean.endsWith('.svg') ||
    clean.endsWith('.bmp') ||
    clean.startsWith('data:image/') ||
    clean.startsWith('blob:')
  );
}

/**
 * Checks whether a given URL points directly to a PDF file.
 */
export function isPdfUrl(url: string): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.pdf') || clean.includes('/pdf');
}

/**
 * Analyzes any document URL and produces an embed-ready object.
 */
export function resolveDocumentEmbed(url: string): ResolvedDocumentEmbed {
  const safeUrl = (url || '').trim();

  if (!safeUrl) {
    return {
      rawUrl: '',
      embedUrl: '',
      isImage: false,
      isPdf: false,
      canEmbed: false,
      sourceType: 'generic',
    };
  }

  // 1. Image check
  if (isImageUrl(safeUrl)) {
    return {
      rawUrl: safeUrl,
      embedUrl: safeUrl,
      isImage: true,
      isPdf: false,
      canEmbed: true,
      sourceType: 'image',
    };
  }

  // 2. Google Drive check
  const drivePreview = formatGoogleDrivePreviewUrl(safeUrl);
  if (drivePreview) {
    return {
      rawUrl: safeUrl,
      embedUrl: drivePreview,
      isImage: false,
      isPdf: true,
      canEmbed: true,
      sourceType: 'google_drive',
    };
  }

  // 3. OneDrive / SharePoint check
  if (safeUrl.includes('sharepoint.com') || safeUrl.includes('1drv.ms') || safeUrl.includes('onedrive.live.com')) {
    let onedriveEmbed = safeUrl;
    if (safeUrl.includes('?') && !safeUrl.includes('action=embedview')) {
      onedriveEmbed = `${safeUrl}&action=embedview`;
    } else if (!safeUrl.includes('action=embedview')) {
      onedriveEmbed = `${safeUrl}?action=embedview`;
    }
    return {
      rawUrl: safeUrl,
      embedUrl: onedriveEmbed,
      isImage: false,
      isPdf: false,
      canEmbed: true,
      sourceType: 'onedrive',
    };
  }

  // 4. Standard PDF check
  if (isPdfUrl(safeUrl)) {
    return {
      rawUrl: safeUrl,
      embedUrl: safeUrl,
      isImage: false,
      isPdf: true,
      canEmbed: true,
      sourceType: 'pdf',
    };
  }

  // 5. Fallback generic
  return {
    rawUrl: safeUrl,
    embedUrl: safeUrl,
    isImage: false,
    isPdf: false,
    canEmbed: true,
    sourceType: 'generic',
  };
}
