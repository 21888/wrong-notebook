export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_FILE_SIZE_MB = 5;

type CompositeImage = {
    fileName: string;
    image: HTMLImageElement;
    naturalWidth: number;
    naturalHeight: number;
};

type CompositeLayoutItem = CompositeImage & {
    width: number;
    height: number;
};

const COMPOSITE_IMAGE_MAX_SIZE_MB = 4.5;
const COMPOSITE_MAX_WIDTH = 1600;
const COMPOSITE_MIN_WIDTH = 720;
const COMPOSITE_MAX_HEIGHT = 20000;
const COMPOSITE_PADDING = 40;
const COMPOSITE_GAP = 28;
const COMPOSITE_LABEL_HEIGHT = 38;

function getDataUrlSizeMB(dataUrl: string): number {
    return (dataUrl.length * 3) / 4 / 1024 / 1024;
}

function canvasToCompressedJpeg(
    canvas: HTMLCanvasElement,
    maxSizeMB: number,
    quality: number = 0.82
): string {
    let currentQuality = quality;
    let compressed = canvas.toDataURL('image/jpeg', currentQuality);

    while (getDataUrlSizeMB(compressed) > maxSizeMB && currentQuality > 0.35) {
        currentQuality -= 0.08;
        compressed = canvas.toDataURL('image/jpeg', currentQuality);
    }

    return compressed;
}

function loadImageFile(file: File): Promise<CompositeImage> {
    return new Promise((resolve, reject) => {
        const imageUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(imageUrl);
            resolve({
                fileName: file.name,
                image: img,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(imageUrl);
            reject(new Error(`图片加载失败: ${file.name}`));
        };
        img.src = imageUrl;
    });
}

function createCompositeLayout(images: CompositeImage[], contentWidth: number) {
    const items: CompositeLayoutItem[] = images.map((image) => {
        const scale = Math.min(1, contentWidth / image.naturalWidth);

        return {
            ...image,
            width: Math.round(image.naturalWidth * scale),
            height: Math.round(image.naturalHeight * scale),
        };
    });

    const totalHeight =
        COMPOSITE_PADDING * 2 +
        items.reduce((sum, item) => sum + COMPOSITE_LABEL_HEIGHT + item.height, 0) +
        COMPOSITE_GAP * Math.max(0, items.length - 1);

    return {
        canvasWidth: contentWidth + COMPOSITE_PADDING * 2,
        canvasHeight: totalHeight,
        items,
    };
}

/**
 * 多张图片按选择顺序纵向拼接成一张图片，复用现有单图 AI 分析与保存链路。
 */
export async function combineImageFiles(files: File[]): Promise<string> {
    if (files.length === 0) {
        throw new Error('未选择图片');
    }

    const images = await Promise.all(files.map(loadImageFile));
    const widestImage = Math.max(...images.map((image) => image.naturalWidth));
    let contentWidth = Math.min(COMPOSITE_MAX_WIDTH, widestImage);
    let layout = createCompositeLayout(images, contentWidth);

    while (layout.canvasHeight > COMPOSITE_MAX_HEIGHT && contentWidth > COMPOSITE_MIN_WIDTH) {
        contentWidth = Math.max(COMPOSITE_MIN_WIDTH, Math.floor(contentWidth * 0.85));
        layout = createCompositeLayout(images, contentWidth);
    }

    const canvas = document.createElement('canvas');
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法获取 Canvas 上下文');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '20px sans-serif';
    ctx.textBaseline = 'middle';

    let y = COMPOSITE_PADDING;
    layout.items.forEach((item, index) => {
        const label = `Image ${index + 1} / ${layout.items.length}: ${item.fileName}`;

        ctx.fillStyle = '#111827';
        ctx.fillText(label, COMPOSITE_PADDING, y + COMPOSITE_LABEL_HEIGHT / 2);

        y += COMPOSITE_LABEL_HEIGHT;

        const imageX = COMPOSITE_PADDING + Math.floor((contentWidth - item.width) / 2);
        ctx.drawImage(item.image, imageX, y, item.width, item.height);
        y += item.height;

        if (index < layout.items.length - 1) {
            const separatorY = y + COMPOSITE_GAP / 2;
            ctx.strokeStyle = '#d1d5db';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 10]);
            ctx.beginPath();
            ctx.moveTo(COMPOSITE_PADDING, separatorY);
            ctx.lineTo(canvas.width - COMPOSITE_PADDING, separatorY);
            ctx.stroke();
            ctx.setLineDash([]);
            y += COMPOSITE_GAP;
        }
    });

    return canvasToCompressedJpeg(canvas, COMPOSITE_IMAGE_MAX_SIZE_MB);
}

/**
 * 压缩图片文件
 * @param file 原始图片文件
 * @param maxSizeMB 最大文件大小（MB），默认 1MB
 * @param maxWidth 最大宽度，默认 1920px
 * @param quality 压缩质量 0-1，默认 0.8
 * @returns 压缩后的 Base64 字符串
 */
export async function compressImage(
    file: File,
    maxSizeMB: number = 1,
    maxWidth: number = 1920,
    quality: number = 0.8
): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('无法获取 Canvas 上下文'));
                    return;
                }

                // 计算新的尺寸（保持宽高比）
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                // 绘制图片
                ctx.drawImage(img, 0, 0, width, height);

                // 转换为 Base64，逐步降低质量直到满足大小要求
                const compressed = canvasToCompressedJpeg(canvas, maxSizeMB, quality);

                console.log(`原始文件: ${(file.size / 1024 / 1024).toFixed(2)}MB, 压缩后: ${((compressed.length * 3) / 4 / 1024 / 1024).toFixed(2)}MB`);

                resolve(compressed);
            };

            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = e.target?.result as string;
        };

        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}

/**
 * 检查并压缩图片（如果需要）
 * @param file 图片文件
 * @returns Base64 字符串
 */
export async function processImageFile(file: File): Promise<string> {
    const fileSizeMB = file.size / 1024 / 1024;
    const threshold = 1; // 1MB 阈值

    console.log(`文件大小: ${fileSizeMB.toFixed(2)}MB`);

    if (fileSizeMB > threshold) {
        console.log('文件超过阈值，开始压缩...');
        return await compressImage(file, threshold);
    } else {
        console.log('文件大小合适，无需压缩');
        // 直接返回 Base64
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}

/**
 * 处理一张或多张上传图片。
 */
export async function processImageFiles(files: File[]): Promise<string> {
    if (files.length === 0) {
        throw new Error('未选择图片');
    }

    if (files.length === 1) {
        return processImageFile(files[0]);
    }

    console.log(`正在合并 ${files.length} 张图片...`);
    return combineImageFiles(files);
}
