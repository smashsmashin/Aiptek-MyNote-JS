const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const pageSelect = document.getElementById('page-select');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const pages = [];
let currentPageIndex = -1;

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

    // Clear existing content
    pages.length = 0;
    pageSelect.innerHTML = '';

    Array.from(files).forEach((file, index) => {
        if (file) { // check if file is not null
            const reader = new FileReader();
            reader.onload = (e) => {
                const pageData = parseTopFile(e.target.result);
                pages.push({ name: file.name, data: pageData });

                const option = document.createElement('option');
                option.value = index;
                option.textContent = file.name;
                pageSelect.appendChild(option);

                // If it's the first file, display it
                if (index === 0) {
                    currentPageIndex = 0;
                    pageSelect.value = 0;
                    drawCurrentPage();
                }
            };
            reader.readAsArrayBuffer(file);
        }
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
        const y = view.getUint16(offset + 1, true); // true for little-endian
        const x = view.getUint16(offset + 3, true); // true for little-endian

        if (currentPath.length === 0) {
            paths.push(currentPath);
        }

        currentPath.push({ x, y: TOP_HEIGHT - y });

        if (penStatus === 0) {
            currentPath = [];
        }
    }

    // Filter out empty paths that might have been added
    return paths.filter(path => path.length > 0);
}

// --- Page Switching ---

pageSelect.addEventListener('change', (e) => {
    currentPageIndex = parseInt(e.target.value, 10);
    drawCurrentPage();
});

// --- Canvas Drawing ---

const CANVAS_WIDTH = 880; // Based on TOP file width of 8800
const CANVAS_HEIGHT = 1200; // Based on TOP file height of 12000
const SCALE_FACTOR = 0.1; // 8800 * 0.1 = 880

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

function drawCurrentPage() {
    if (currentPageIndex < 0 || currentPageIndex >= pages.length) {
        // Clear canvas if no page is selected
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const page = pages[currentPageIndex];
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;

    ctx.beginPath();
    page.data.forEach(path => {
        if (path.length > 0) {
            const startPoint = path[0];
            ctx.moveTo(startPoint.x * SCALE_FACTOR, startPoint.y * SCALE_FACTOR);
            for (let i = 1; i < path.length; i++) {
                const point = path[i];
                ctx.lineTo(point.x * SCALE_FACTOR, point.y * SCALE_FACTOR);
            }
        }
    });
    ctx.stroke();
}