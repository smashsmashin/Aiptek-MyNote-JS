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

    // Don't clear on drop, append new files
    const newFiles = Array.from(files).filter(file => file);

    newFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const pageData = parseTopFile(e.target.result);
            const pageIndex = pages.length;
            pages.push({ name: file.name, data: pageData });

            const listItem = document.createElement('li');
            listItem.textContent = file.name;
            listItem.dataset.index = pageIndex;
            listItem.addEventListener('click', () => {
                switchPage(pageIndex);
            });
            pageList.appendChild(listItem);

            // If it's the first file ever, display it
            if (pageIndex === 0) {
                switchPage(0);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// --- TOP File Parser ---

const TOP_HEADER_SIZE = 32;
const TOP_PACKET_SIZE = 6;
const TOP_HEIGHT = 12000;

function parseTopFile(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const paths = [];
    let currentPath = [];

    for (let offset = TOP_HEADER_SIZE; offset + TOP_PACKET_SIZE <= view.byteLength; offset += TOP_PACKET_SIZE) {
        const penStatus = view.getUint8(offset);
        const y = view.getInt16(offset + 1, true); // true for little-endian
        const x = view.getInt16(offset + 3, true); // true for little-endian

        if (currentPath.length === 0) {
            paths.push(currentPath);
        }

        currentPath.push({ x, y: TOP_HEIGHT - y });

        if (penStatus === 0) {
            currentPath = [];
        }
    }
    return paths.filter(path => path.length > 0);
}

// --- Page Switching ---

function switchPage(index) {
    if (index < 0 || index >= pages.length) return;

    currentPageIndex = index;
    selectionMin = 0;
    selectionMax = 0;

    // Update active class on list items
    Array.from(pageList.children).forEach((item, i) => {
        if (i === currentPageIndex) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    drawCurrentPage();
    updateThumbs();
}

// --- Canvas Drawing ---

const PAGE_ASPECT_RATIO = 210 / 297; // A4 paper
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };


function resizeCanvas() {
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;

    // Set canvas drawing buffer size
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

    const page = pages[currentPageIndex];
    const containerWidth = canvas.width;
    const containerHeight = canvas.height;

    // Clear content section (light gray background)
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    // --- Calculate paper size and position ---
    const margin = 20; // 20px margin
    let paperWidth, paperHeight;

    // Determine paper size based on container and aspect ratio
    if ((containerWidth - 2 * margin) / (containerHeight - 2 * margin) > PAGE_ASPECT_RATIO) {
        // Height is the limiting factor
        paperHeight = (containerHeight - 2 * margin) * scale;
        paperWidth = paperHeight * PAGE_ASPECT_RATIO;
    } else {
        // Width is the limiting factor
        paperWidth = (containerWidth - 2 * margin) * scale;
        paperHeight = paperWidth / PAGE_ASPECT_RATIO;
    }

    // --- Panning constraints ---
    const panMargin = 20; // in pixels
    const minX = -(paperWidth - containerWidth) - panMargin;
    const maxX = margin;
    const minY = -(paperHeight - containerHeight) - margin;
    const maxY = margin;

    if (paperWidth > containerWidth) {
        panX = Math.max(minX, Math.min(maxX, panX));
    } else {
        panX = 0; // Center if smaller
    }

    if (paperHeight > containerHeight) {
        panY = Math.max(minY, Math.min(maxY, panY));
    } else {
        panY = 0; // Center if smaller
    }


    // Center the paper
    let paperX, paperY;
    if (paperWidth < containerWidth) {
        paperX = (containerWidth - paperWidth) / 2;
    } else {
        paperX = panX;
    }
    if (paperHeight < containerHeight) {
        paperY = (containerHeight - paperHeight) / 2;
    } else {
        paperY = panY;
    }


    // --- Draw the white paper ---
    ctx.fillStyle = 'white';
    ctx.save(); // Save context before clipping
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.fillRect(paperX, paperY, paperWidth, paperHeight);
    ctx.shadowColor = 'transparent'; // Turn off shadow for content
    ctx.restore(); // Restore context after drawing paper

    // --- Set up coordinate system for drawing content ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(paperX, paperY, paperWidth, paperHeight);
    ctx.clip(); // Don't draw outside the paper

    ctx.translate(paperX, paperY);

    const contentScale = paperWidth / 8800; // TOP files have a width of 8800 units
    ctx.scale(contentScale, contentScale);

    // --- Draw the strokes ---
    ctx.lineWidth = 1 / contentScale; // Keep line width consistent when zooming

    page.data.forEach((path, i) => {
        if (path.length > 0) {
            ctx.strokeStyle = (i >= selectionMin && i < selectionMax) ? 'blue' : 'black';
            ctx.beginPath();
            const startPoint = path[0];
            ctx.moveTo(startPoint.x, startPoint.y);
            for (let j = 1; j < path.length; j++) {
                const point = path[j];
                ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
        }
    });

    ctx.restore(); // Restore to original state (before translate/scale/clip)
}

// --- User Interaction for Pan and Zoom ---

contentSection.addEventListener('wheel', (e) => {
    e.preventDefault();

    if (e.ctrlKey) {
        // Zoom
        const zoomIntensity = 0.05;
        const scroll = e.deltaY < 0 ? 1 : -1;
        const zoom = Math.exp(scroll * zoomIntensity);

        const rect = contentSection.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const mouseBeforeZoomX = (mouseX - panX) / scale;
        const mouseBeforeZoomY = (mouseY - panY) / scale;

        scale *= zoom;

        const mouseAfterZoomX = (mouseX - panX) / scale;
        const mouseAfterZoomY = (mouseY - panY) / scale;

        panX += (mouseAfterZoomX - mouseBeforeZoomX) * scale;
        panY += (mouseAfterZoomY - mouseBeforeZoomY) * scale;
    } else if (e.shiftKey) {
        // Horizontal scroll
        panX -= e.deltaY;
    } else {
        // Vertical scroll
        panY -= e.deltaY;
    }

    drawCurrentPage();
});

canvasContainer.addEventListener('mousedown', (e) => {
    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    canvasContainer.style.cursor = 'grabbing';
});

canvasContainer.addEventListener('mouseup', () => {
    isPanning = false;
    canvasContainer.style.cursor = 'grab';
});

canvasContainer.addEventListener('mouseleave', () => {
    isPanning = false;
    canvasContainer.style.cursor = 'default';
});

canvasContainer.addEventListener('mousemove', (e) => {
    if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        panX += dx;
        panY += dy;
        panStart.x = e.clientX;
        panStart.y = e.clientY;
        drawCurrentPage();
    }
});

// --- Selection Bar Interaction ---

function updateThumbs() {
    if (currentPageIndex < 0) return;
    const page = pages[currentPageIndex];
    const totalPaths = page.data.length;

    if (selectionMin === selectionMax) {
        selectionBar.classList.add('side-by-side');
    } else {
        selectionBar.classList.remove('side-by-side');
    }

    if (totalPaths === 0) {
        minThumb.style.top = '0%';
        maxThumb.style.top = '0%';
        return;
    }

    // Use totalPaths for percentage calculation to prevent thumb going off-screen
    const minPercent = (selectionMin / totalPaths) * 100;
    const maxPercent = (selectionMax / totalPaths) * 100;

    minThumb.style.top = `${minPercent}%`;
    maxThumb.style.top = `${maxPercent}%`;
}


let activeThumb = null;

function onThumbMouseDown(event) {
    if (event.target === minThumb) {
        activeThumb = minThumb;
    } else if (event.target === maxThumb) {
        activeThumb = maxThumb;
    }
    document.addEventListener('mousemove', onThumbMouseMove);
    document.addEventListener('mouseup', onThumbMouseUp);
}

function onThumbMouseUp() {
    activeThumb = null;
    document.removeEventListener('mousemove', onThumbMouseMove);
    document.removeEventListener('mouseup', onThumbMouseUp);
}

function onThumbMouseMove(event) {
    if (!activeThumb || currentPageIndex < 0) return;

    const page = pages[currentPageIndex];
    const totalPaths = page.data.length;
    if (totalPaths <= 1) return;

    const barRect = selectionBar.getBoundingClientRect();
    const offsetY = event.clientY - barRect.top;
    const percent = Math.max(0, Math.min(100, (offsetY / barRect.height) * 100));
    const value = Math.round((totalPaths * percent) / 100);

    if (activeThumb === minThumb) {
        selectionMin = Math.min(value, selectionMax);
    } else { // activeThumb === maxThumb
        selectionMax = Math.max(value, selectionMin);
    }

    selectionMin = Math.max(0, selectionMin);
    selectionMax = Math.min(totalPaths, selectionMax);


    updateThumbs();
    drawCurrentPage();
}

minThumb.addEventListener('mousedown', onThumbMouseDown);
maxThumb.addEventListener('mousedown', onThumbMouseDown);

function handleThumbKeyDown(event) {
    const thumb = event.target;
    const isArrowKey = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    let step = 0;

    if (event.key === 'ArrowUp') {
        step = -1;
    } else if (event.key === 'ArrowDown') {
        step = 1;
    } else if (event.key === 'PageUp') {
        step = -100;
    } else if (event.key === 'PageDown') {
        step = 100;
    }

    if (step === 0 || currentPageIndex < 0) return;

    event.preventDefault();

    const page = pages[currentPageIndex];
    const totalPaths = page.data.length;

    if (thumb === minThumb) {
        selectionMin = Math.max(0, Math.min(selectionMin + step, selectionMax));
        if (isArrowKey) {
            console.log(`Min thumb: ${selectionMin}`);
            if (selectionMin === selectionMax) {
                console.log("No selected path.");
            } else {
                const path = page.data[selectionMin];
                if (path) {
                    console.log(`Path ${selectionMin}: ${JSON.stringify(path.map(p => `(${p.x},${p.y})`))}`);
                } else {
                    console.log("No selected path.");
                }
            }
        }
    } else { // thumb === maxThumb
        selectionMax = Math.max(selectionMin, Math.min(selectionMax + step, totalPaths));
        if (isArrowKey) {
            console.log(`Max thumb: ${selectionMax}`);
            if (selectionMin === selectionMax) {
                console.log("No selected path.");
            } else {
                const pathIndex = selectionMax - 1;
                const path = page.data[pathIndex];
                if (path) {
                    console.log(`Path ${pathIndex}: ${JSON.stringify(path.map(p => `(${p.x},${p.y})`))}`);
                } else {
                    console.log("No selected path.");
                }
            }
        }
    }

    updateThumbs();
    drawCurrentPage();
}

minThumb.addEventListener('keydown', handleThumbKeyDown);
maxThumb.addEventListener('keydown', handleThumbKeyDown);


// Initial setup
resizeCanvas();
canvasContainer.style.cursor = 'grab';