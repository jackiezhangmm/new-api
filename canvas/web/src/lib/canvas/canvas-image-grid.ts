export async function splitMidjourneyGrid(image: Blob): Promise<Blob[]> {
    const source = await createImageBitmap(image);
    try {
        const tileWidth = Math.floor(source.width / 2);
        const tileHeight = Math.floor(source.height / 2);
        if (tileWidth < 1 || tileHeight < 1) {
            throw new Error("Midjourney 切图尺寸非法");
        }

        return await Promise.all(
            [
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
            ].map(([column, row]) => {
                const canvas = document.createElement("canvas");
                canvas.width = tileWidth;
                canvas.height = tileHeight;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas 上下文不可用");
                context.drawImage(
                    source,
                    column * tileWidth,
                    row * tileHeight,
                    tileWidth,
                    tileHeight,
                    0,
                    0,
                    tileWidth,
                    tileHeight,
                );
                return new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error("Midjourney 四宫格切图失败"));
                        }
                    }, "image/png");
                });
            }),
        );
    } finally {
        source.close();
    }
}
