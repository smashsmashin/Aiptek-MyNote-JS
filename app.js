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

    const newFiles = Array.from(files).filter(file => file);
    let firstNewPageIndex = pages.length;

    const readPromises = newFiles.map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const pageData = parseTopFile(e.target.result);
                pages.push({ name: file.name, data: pageData });
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
            // Re-select the current page to ensure the view is consistent
            // especially if files were added while a page was active.
            switchPage(currentPageIndex);
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

// --- Page List Rendering ---

function renderPageList() {
    pageList.innerHTML = ''; // Clear existing list

    pages.forEach((page, index) => {
        const listItem = document.createElement('li');
        listItem.dataset.index = index;
        listItem.draggable = true;

        if (index === currentPageIndex) {
            listItem.classList.add('active');
        }

        const pageName = document.createElement('span');
        pageName.className = 'page-name';
        pageName.textContent = page.name;
        // Clicking the name switches to the page
        pageName.addEventListener('click', () => switchPage(index));

        const pageActions = document.createElement('div');
        pageActions.className = 'page-actions';

        const upButton = document.createElement('button');
        upButton.textContent = '▲';
        upButton.title = 'Move Up';
        upButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent page switch
            movePage(index, index - 1);
        });

        const downButton = document.createElement('button');
        downButton.textContent = '▼';
        downButton.title = 'Move Down';
        downButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent page switch
            movePage(index, index + 1);
        });

        const deleteButton = document.createElement('button');
        deleteButton.textContent = '✖';
        deleteButton.title = 'Delete Page';
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent page switch
            deletePage(index);
        });

        pageActions.appendChild(upButton);
        pageActions.appendChild(downButton);
        pageActions.appendChild(deleteButton);
        listItem.appendChild(pageName);
        listItem.appendChild(pageActions);
        pageList.appendChild(listItem);
    });

    // Add drag-and-drop event listeners
    addDragDropListeners();
}

function switchPage(index) {
    if (index < 0 || index >= pages.length) {
        // If the current page was deleted, switch to a valid one
        if (pages.length === 0) {
            currentPageIndex = -1;
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
        } else {
            currentPageIndex = Math.max(0, Math.min(index, pages.length - 1));
        }
    } else {
        currentPageIndex = index;
    }


    selectionMin = 0;
    selectionMax = 0;

    renderPageList(); // Re-render to update the 'active' state
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


// --- Page Reordering ---

function movePage(oldIndex, newIndex) {
    if (newIndex < 0 || newIndex >= pages.length) return;

    // Move the item in the array
    const [movedPage] = pages.splice(oldIndex, 1);
    pages.splice(newIndex, 0, movedPage);

    // If the moved page was the current one, update its index
    if (currentPageIndex === oldIndex) {
        currentPageIndex = newIndex;
    } else if (currentPageIndex >= newIndex && currentPageIndex < oldIndex) {
        // If an item was moved to before the current item, increment current item's index
        currentPageIndex++;
    } else if (currentPageIndex <= newIndex && currentPageIndex > oldIndex) {
        // If an item was moved to after the current item, decrement current item's index
        currentPageIndex--;
    }


    renderPageList();
    switchPage(currentPageIndex); // Re-select the (possibly new) current page
}

let draggedIndex = null;

function addDragDropListeners() {
    const listItems = pageList.querySelectorAll('li');

    listItems.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedIndex = parseInt(e.currentTarget.dataset.index, 10);
            e.currentTarget.classList.add('dragging');
            // Allow the drop event
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', (e) => {
            e.currentTarget.classList.remove('dragging');
            draggedIndex = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault(); // This is necessary to allow a drop
            const targetIndex = parseInt(e.currentTarget.dataset.index, 10);
            if (draggedIndex !== null && draggedIndex !== targetIndex) {
                // Basic visual feedback, could be improved
                // For example, by inserting a placeholder element
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetIndex = parseInt(e.currentTarget.dataset.index, 10);
            if (draggedIndex !== null && draggedIndex !== targetIndex) {
                movePage(draggedIndex, targetIndex);
            }
        });
    });
}


// --- Deletion Handling ---

function deletePage(index) {
    if (index < 0 || index >= pages.length) return false;

    const pageName = pages[index].name;
    const confirmed = window.confirm(`Are you sure you want to delete the page "${pageName}"?`);

    if (confirmed) {
        pages.splice(index, 1);

        // Adjust currentPageIndex if necessary
        if (currentPageIndex === index) {
            // If the deleted page was the last one, select the new last one
            switchPage(Math.max(0, index - 1));
        } else if (currentPageIndex > index) {
            // If a page before the current one was deleted, decrement the index
            switchPage(currentPageIndex - 1);
        } else {
            // Otherwise, the index is still valid, just re-render
            renderPageList();
        }
        return true; // Deletion was successful
    }
    return false; // Deletion was cancelled
}


function handleDeleteKey(event) {
    if (event.key !== 'Delete' || currentPageIndex < 0) return;
    if (selectionMin >= selectionMax) return; // No selection to delete

    const confirmed = window.confirm(`Are you sure you want to delete ${selectionMax - selectionMin} selected path(s)?`);

    if (confirmed) {
        const page = pages[currentPageIndex];
        const deleteCount = selectionMax - selectionMin;
        page.data.splice(selectionMin, deleteCount);

        // Reset selection
        selectionMax = selectionMin;

        // If all paths are deleted, attempt to remove the page itself
        if (page.data.length === 0) {
            console.log(`Page "${page.name}" is now empty. Prompting for deletion.`);
            const wasDeleted = deletePage(currentPageIndex);

            // If the page was NOT deleted (e.g., user cancelled), we still
            // need to refresh the canvas to show that the paths are gone.
            if (!wasDeleted) {
                updateThumbs();
                drawCurrentPage();
            }
        } else {
            // Otherwise, just update the view
            updateThumbs();
            drawCurrentPage();
        }
    }
}

window.addEventListener('keydown', handleDeleteKey);


// --- Printing ---

function printAllPages() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups to print.');
        return;
    }

    const printDoc = printWindow.document;
    printDoc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Print</title>
            <style>
                @page { size: A4 portrait; margin: 0; }
                body { margin: 0; }
                .page-container { page-break-after: always; }
                .page-container:last-child { page-break-after: avoid; }
                canvas { display: block; width: 100%; height: auto; }
            </style>
        </head>
        <body></body>
        </html>
    `);

    const printBody = printDoc.body;
    pages.forEach(page => {
        const pageContainer = printDoc.createElement('div');
        pageContainer.className = 'page-container';

        const printCanvas = printDoc.createElement('canvas');
        const printCtx = printCanvas.getContext('2d');
        const printWidth = 2480; // A4 @ 300 DPI
        const printHeight = 3508;
        printCanvas.width = printWidth;
        printCanvas.height = printHeight;

        printCtx.fillStyle = 'white';
        printCtx.fillRect(0, 0, printWidth, printHeight);

        const contentScale = printWidth / 8800;
        printCtx.scale(contentScale, contentScale);
        printCtx.lineWidth = 1;
        printCtx.strokeStyle = 'black';

        page.data.forEach(path => {
            if (path.length > 0) {
                printCtx.beginPath();
                const startPoint = path[0];
                printCtx.moveTo(startPoint.x, startPoint.y);
                for (let j = 1; j < path.length; j++) {
                    const point = path[j];
                    printCtx.lineTo(point.x, point.y);
                }
                printCtx.stroke();
            }
        });
        pageContainer.appendChild(printCanvas);
        printBody.appendChild(pageContainer);
    });

    printDoc.close();

    // Wait for content to be loaded before printing
    printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
        // Closing the window automatically can be problematic
        // printWindow.close();
    };
}

// Intercept Ctrl+P
window.addEventListener('keydown', e => {
    // Use toLowerCase() to handle CapsLock
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        printAllPages();
    }
});


// Initial setup
resizeCanvas();
canvasContainer.style.cursor = 'grab';