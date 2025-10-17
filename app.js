const TOP_HEADER_SIZE = 32;
const TOP_PACKET_SIZE = 6;
const TOP_HEIGHT = 12000;

function compressPointsWithHeader(base64FileContent) {
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    const fileBuffer = base64ToArrayBuffer(base64FileContent);
    const headerSize = 32;
    const fileBytes = new Uint8Array(fileBuffer);
    const pointDataView = new DataView(fileBuffer, headerSize);
    const numPoints = (fileBuffer.byteLength - headerSize) / 6;
    const compressedChunks = [];
    let previousX = 0;
    let previousY = 0;
    let previousP = 0;
    let isPathStarted = false;
    const createBlock = (size) => new DataView(new ArrayBuffer(size));
    const headerBuffer = fileBytes.slice(0, headerSize);
    compressedChunks.push(headerBuffer.buffer);
    for (let i = 0; i < numPoints; i++) {
        const offset = i * 6;
        const status = pointDataView.getUint8(offset);
        const currentX = pointDataView.getInt16(offset + 1, true);
        const currentY = pointDataView.getInt16(offset + 3, true);
        const currentP = pointDataView.getUint8(offset + 5);
        if (status != 0) {
            if (!isPathStarted) {
                const blockView = createBlock(6);
                let firstByte = status & 0x7f;
                if (status & 0x80) firstByte |= 0x40;
                blockView.setUint8(0, firstByte);
                blockView.setInt16(1, currentX, true);
                blockView.setInt16(3, currentY, true);
                blockView.setUint8(5, currentP);
                compressedChunks.push(blockView.buffer);
                isPathStarted = true;
            } else {
                const deltaX = currentX - previousX;
                const deltaY = currentY - previousY;
                const deltaP = currentP - previousP;
                const isCompact = Math.abs(deltaX) < 32 && Math.abs(deltaY) < 32 && Math.abs(deltaP) < 4;
                if (isCompact) {
                    const blockView = createBlock(2);
                    let byte1 = 0x80;
                    byte1 |= (deltaX & 0x3F) << 1;
                    byte1 |= (deltaY >> 5) & 0x01;
                    blockView.setUint8(0, byte1);
                    let byte2 = 0;
                    byte2 |= (deltaY & 0x1F) << 3;
                    byte2 |= (deltaP & 0x07);
                    blockView.setUint8(1, byte2);
                    compressedChunks.push(blockView.buffer);
                } else {
                    const blockView = createBlock(6);
                    let firstByte = status & 0x7f;
                    if (status & 0x80) firstByte |= 0x40;
                    blockView.setUint8(0, firstByte);
                    blockView.setInt16(1, currentX, true);
                    blockView.setInt16(3, currentY, true);
                    blockView.setUint8(5, currentP);
                    compressedChunks.push(blockView.buffer);
                }
            }
            previousX = currentX;
            previousY = currentY;
            previousP = currentP;
        } else {
            const blockView = createBlock(1);
            blockView.setUint8(0, 0);
            compressedChunks.push(blockView.buffer);
            isPathStarted = false;
        }
    }
    const totalLength = compressedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const finalCompressedBuffer = new Uint8Array(totalLength);
    let outOffset = 0;
    for (const chunk of compressedChunks) {
        finalCompressedBuffer.set(new Uint8Array(chunk), outOffset);
        outOffset += chunk.byteLength;
    }
    return arrayBufferToBase64(finalCompressedBuffer.buffer);
}

function decompressPointsWithHeader(base64CompressedContent) {
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    const getSignedValue = (value, bitCount) => {
        console.log(`getSignedValue: value=${value}, bitCount=${bitCount}`);
        const signBit = 1 << (bitCount - 1);
        if (value & signBit) {
            const result = value - (1 << bitCount);
            console.log(`getSignedValue: result=${result}`);
            return result;
        }
        console.log(`getSignedValue: result=${value}`);
        return value;
    };
    const createPoint = (status, x, y, pressure) => {
        const buffer = new ArrayBuffer(6);
        const pointView = new DataView(buffer);
        pointView.setUint8(0, status);
        pointView.setInt16(1, x, true);
        pointView.setInt16(3, y, true);
        pointView.setUint8(5, pressure);
        return buffer;
    };
    const compressedBuffer = base64ToArrayBuffer(base64CompressedContent);
    const compressedView = new DataView(compressedBuffer);
    const decompressedPoints = [];
    const headerSize = 32;
    const compressedBytes = new Uint8Array(compressedBuffer);
    const headerBuffer = compressedBytes.slice(0, headerSize).buffer;
    let offset = headerSize;
    let previousX = 0;
    let previousY = 0;
    let previousP = 0;
    let previousStatus = 0;
    while (offset < compressedBuffer.byteLength) {
        const byte1 = compressedView.getUint8(offset);
        const isCompact = (byte1 & 0x80) === 0x80;
        const isStatusZeroByte = byte1 === 0x00;
        let currentX, currentY, currentP, status;
        let consumedBytes = 0;
        if (isStatusZeroByte) {
            consumedBytes = 1;
            if (decompressedPoints.length === 0) {
                offset += consumedBytes;
                continue;
            }
            currentX = previousX;
            currentY = previousY;
            currentP = previousP;
            status = 0;
        } else if (isCompact) {
            consumedBytes = 2;
            const byte2 = compressedView.getUint8(offset + 1);
            const dxEncoded = (byte1 >> 1) & 0x3F;
            const deltaX = getSignedValue(dxEncoded, 6);
            const dyUpper = byte1 & 0x01;
            const dyLower = (byte2 >> 3) & 0x1F;
            const dyEncoded = (dyUpper << 5) | dyLower;
            const deltaY = getSignedValue(dyEncoded, 6);
            const dpEncoded = byte2 & 0x07;
            const deltaP = getSignedValue(dpEncoded, 3);
            currentX = previousX + deltaX;
            currentY = previousY + deltaY;
            currentP = previousP + deltaP;
            status = 135;
        } else {
            consumedBytes = 6;
            status = byte1;
            if (status & 0x40) {
                status |= 0x80;
                status &= 0xB7;
            }
            currentX = compressedView.getInt16(offset + 1, true);
            currentY = compressedView.getInt16(offset + 3, true);
            currentP = compressedView.getUint8(offset + 5);
        }
        previousX = currentX;
        previousY = currentY;
        previousP = currentP;
        previousStatus = status;
        decompressedPoints.push(createPoint(status, currentX, currentY, currentP));
        offset += consumedBytes;
    }
    const totalPointsLength = decompressedPoints.length * 6;
    const finalBuffer = new Uint8Array(headerSize + totalPointsLength);
    finalBuffer.set(new Uint8Array(headerBuffer), 0);
    let outOffset = headerSize;
    for (const chunk of decompressedPoints) {
        finalBuffer.set(new Uint8Array(chunk), outOffset);
        outOffset += 6;
    }
    return arrayBufferToBase64(finalBuffer.buffer);
}

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const pageList = document.getElementById('page-list');
    const contentSection = document.getElementById('content-section');
    const canvasContainer = document.getElementById('canvas-container');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const selectionBar = document.getElementById('selection-bar');
    const minThumb = document.getElementById('min-thumb');
    const maxThumb = document.getElementById('max-thumb');

    const titleBar = document.getElementById('title-bar');
    const documentTitle = document.getElementById('document-title');
    const loadButton = document.getElementById('load-button');
    const saveButton = document.getElementById('save-button');
    const loginButton = document.getElementById('login-button');

    const pages = [];
    let currentPageIndex = -1;
    let selectionMin = 0;
    let selectionMax = 0;

    // --- File Handling ---

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFiles(files);
    });

    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        handleFiles(files);
    });

    function handleFiles(files) {
        if (files.length === 0) return;

        const newFiles = Array.from(files).filter(file => file);

        const readPromises = newFiles.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    // Store the raw ArrayBuffer and clear any cached parsed data
                    pages.push({
                        name: file.name,
                        fileBuffer: e.target.result,
                        parsedData: null
                    });
                    resolve();
                };
                reader.readAsArrayBuffer(file);
            });
        });

        Promise.all(readPromises).then(() => {
            renderPageList();
            if (currentPageIndex === -1 && pages.length > 0) {
                switchPage(0);
            } else {
                // Refresh the current page view if files are added
                switchPage(currentPageIndex);
            }
        });
    }

    function getPageData(index) {
        if (index < 0 || index >= pages.length) return null;
        const page = pages[index];

        // If data is already parsed and cached, return it
        if (page.parsedData) {
            return page.parsedData;
        }

        // Otherwise, parse the fileBuffer and cache the result
        const parsedData = parseTopFile(page.fileBuffer);
        page.parsedData = parsedData;
        return parsedData;
    }

    function parseTopFile(arrayBuffer) {
        const header = arrayBuffer.slice(0, TOP_HEADER_SIZE);
        const view = new DataView(arrayBuffer);
        const paths = [];
        let currentPath = [];

        for (let offset = TOP_HEADER_SIZE; offset + TOP_PACKET_SIZE <= view.byteLength; offset += TOP_PACKET_SIZE) {
            const penStatus = view.getUint8(offset);
            const y = view.getInt16(offset + 1, true);
            const x = view.getInt16(offset + 3, true);
            const p = view.getUint8(offset + 5);

            if (penStatus !== 0 && currentPath.length === 0) {
                paths.push(currentPath);
            }

            currentPath.push({ x, y: TOP_HEIGHT - y, p, penStatus });

            if (penStatus === 0) {
                currentPath = [];
            }
        }
        return { header, data: paths.filter(path => path.length > 1) }; // Keep only paths with actual lines
    }

    function convertToTop(pageData) {
        const packets = [];
        pageData.data.forEach(path => {
            if (path.length > 0) {
                path.forEach(point => {
                    const packet = new ArrayBuffer(TOP_PACKET_SIZE);
                    const view = new DataView(packet);
                    view.setUint8(0, point.penStatus);
                    // Y is stored inverted in the file
                    view.setInt16(1, point.y, true);
                    view.setInt16(3, point.x, true);
                    view.setUint8(5, point.p || 0);
                    packets.push(packet);
                });
            }
        });

        const totalSize = TOP_HEADER_SIZE + packets.length * TOP_PACKET_SIZE;
        const buffer = new ArrayBuffer(totalSize);
        const combined = new Uint8Array(buffer);

        combined.set(new Uint8Array(pageData.header), 0);

        let offset = TOP_HEADER_SIZE;
        packets.forEach(packet => {
            combined.set(new Uint8Array(packet), offset);
            offset += TOP_PACKET_SIZE;
        });

        return buffer;
    }

    function showContextMenu(target, index) {
        console.log("Context menu for page " + index + " requested.");
    }

    function closeContextMenu() {
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
    }

    function renderPageList() {
        pageList.innerHTML = '';
        closeContextMenu();
        pages.forEach((page, index) => {
            const listItem = document.createElement('li');
            listItem.dataset.index = index;
            listItem.draggable = true;
            if (index === currentPageIndex) {
                listItem.classList.add('active');
            }
            listItem.addEventListener('click', () => switchPage(index));
            const pageName = document.createElement('span');
            pageName.className = 'page-name';
            pageName.textContent = page.name;
            const menuButton = document.createElement('button');
            menuButton.className = 'context-menu-button';
            menuButton.innerHTML = '&#x22EE;';
            menuButton.addEventListener('click', (e) => {
                e.stopPropagation();
                showContextMenu(e.currentTarget, index);
            });
            listItem.appendChild(pageName);
            listItem.appendChild(menuButton);
            pageList.appendChild(listItem);
        });
        addDragDropListeners();
    }

    function switchPage(index) {
        if (index < 0 || index >= pages.length) {
            if (pages.length === 0) {
                currentPageIndex = -1;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            } else {
                currentPageIndex = Math.max(0, Math.min(index, pages.length - 1));
            }
        } else {
            currentPageIndex = index;
        }
        selectionMin = 0;
        selectionMax = 0;
        renderPageList();
        drawCurrentPage();
        updateThumbs();
    }
    const PAGE_ASPECT_RATIO = 210 / 297;
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let splitPreview = null;
    let mergePreview = null;
    function resizeCanvas() {
        const containerWidth = canvasContainer.clientWidth;
        const containerHeight = canvasContainer.clientHeight;
        canvas.width = containerWidth;
        canvas.height = containerHeight;
        drawCurrentPage();
    }
    window.addEventListener('resize', resizeCanvas);
    function drawCurrentPage() {
        if (currentPageIndex < 0 || currentPageIndex >= pages.length) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        const page = getPageData(currentPageIndex);
        if (!page) return;

        const containerWidth = canvas.width;
        const containerHeight = canvas.height;
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(0, 0, containerWidth, containerHeight);
        const margin = 20;
        let paperWidth, paperHeight;
        if ((containerWidth - 2 * margin) / (containerHeight - 2 * margin) > PAGE_ASPECT_RATIO) {
            paperHeight = (containerHeight - 2 * margin) * scale;
            paperWidth = paperHeight * PAGE_ASPECT_RATIO;
        } else {
            paperWidth = (containerWidth - 2 * margin) * scale;
            paperHeight = paperWidth / PAGE_ASPECT_RATIO;
        }
        const panMargin = 20;
        if (paperWidth > containerWidth) {
            panX = Math.max(-(paperWidth - containerWidth) - panMargin, Math.min(margin, panX));
        } else {
            panX = 0;
        }
        if (paperHeight > containerHeight) {
            panY = Math.max(-(paperHeight - containerHeight) - margin, Math.min(margin, panY));
        } else {
            panY = 0;
        }
        let paperX = (paperWidth < containerWidth) ? (containerWidth - paperWidth) / 2 : panX;
        let paperY = (paperHeight < containerHeight) ? (containerHeight - paperHeight) / 2 : panY;
        ctx.fillStyle = 'white';
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;
        ctx.fillRect(paperX, paperY, paperWidth, paperHeight);
        ctx.shadowColor = 'transparent';
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(paperX, paperY, paperWidth, paperHeight);
        ctx.clip();
        ctx.translate(paperX, paperY);
        const contentScale = paperWidth / 8800;
        ctx.scale(contentScale, contentScale);
        const baseLineWidth = 1 / contentScale;
        const isMergePreview = mergePreview && mergePreview.index === currentPageIndex;
        const pageToRender = isMergePreview ? mergePreview : page;
        const isSplitPreview = splitPreview && splitPreview.index === currentPageIndex;

        // Use a consistent data source for rendering
        const renderData = isMergePreview ? mergePreview.data : (isSplitPreview ? splitPreview.data : page.data);

        renderData.forEach((path, i) => {
            if (path.length > 0) {
                let strokeStyle = 'black';
                let lineWidth = baseLineWidth;

                if (isMergePreview) {
                    strokeStyle = 'purple';
                } else if (isSplitPreview) {
                    strokeStyle = i < splitPreview.splitPoint ? 'blue' : 'red';
                } else {
                    const isSelected = i >= selectionMin && i < selectionMax;
                    if (isSelected) {
                        strokeStyle = 'blue';
                        lineWidth = baseLineWidth * 3;
                    }
                }

                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.moveTo(path[0].x, path[0].y);
                for (let j = 1; j < path.length; j++) {
                    ctx.lineTo(path[j].x, path[j].y);
                }
                ctx.stroke();
            }
        });
        ctx.restore();
    }

    function mergePage(index, direction) {
        const otherIndex = direction === 'up' ? index - 1 : index + 1;
        if (otherIndex < 0 || otherIndex >= pages.length) return;

        const topPageIndex = direction === 'up' ? otherIndex : index;
        const bottomPageIndex = direction === 'up' ? index : otherIndex;

        const topPageData = getPageData(topPageIndex);
        const bottomPageData = getPageData(bottomPageIndex);
        if (!topPageData || !bottomPageData) return;

        const newName = `${pages[topPageIndex].name}-${pages[bottomPageIndex].name}`;
        const mergedData = {
            header: topPageData.header, // Keep header of the top page
            data: [...topPageData.data, ...bottomPageData.data]
        };

        // Set up preview state
        mergePreview = { index: topPageIndex, ...mergedData };
        switchPage(topPageIndex); // Show the preview on the top page's slot

        const message = `Merge "${pages[topPageIndex].name}" and "${pages[bottomPageIndex].name}" into "${newName}"?`;

        setTimeout(() => {
            const confirmed = window.confirm(message);
            mergePreview = null; // Clear preview state

            if (confirmed) {
                const mergedBuffer = convertToTop(mergedData);
                const mergedPage = {
                    name: newName,
                    fileBuffer: mergedBuffer,
                    parsedData: mergedData
                };

                pages.splice(topPageIndex, 2, mergedPage);
                switchPage(topPageIndex);
            } else {
                drawCurrentPage(); // Redraw to clear the preview
            }
        }, 10);
    }

    // ... (rest of the file is the same)
});