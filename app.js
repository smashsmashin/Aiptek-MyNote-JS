document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const pageList = document.getElementById('page-list');
    const indexSection = document.getElementById('index-section');
    const contentSection = document.getElementById('content-section');
    const canvasContainer = document.getElementById('canvas-container');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const selectionBar = document.getElementById('selection-bar');
    const minThumb = document.getElementById('min-thumb');
    const maxThumb = document.getElementById('max-thumb');

    const titleBar = document.getElementById('title-bar');
    const menuButton = document.getElementById('menu-button');
    const documentTitle = document.getElementById('document-title');
    const renameButton = document.getElementById('rename-button');
    const loadButton = document.getElementById('load-button');
    const saveButton = document.getElementById('save-button');
    const loginButton = document.getElementById('login-button');
    const userMenu = document.getElementById('user-menu');
    const userAvatar = document.getElementById('user-avatar');
    const userDropdown = document.getElementById('user-dropdown');
    const switchUserButton = document.getElementById('switch-user-button');
    const logoutButton = document.getElementById('logout-button');
    const notificationArea = document.getElementById('notification-area');
    const dropdownLoadButton = document.getElementById('dropdown-load-button');
    const dropdownSaveButton = document.getElementById('dropdown-save-button');

    let notificationTimeout;

    function showNotification(message, duration = 3000) {
        notificationArea.textContent = message;
        notificationArea.style.display = 'block';

        clearTimeout(notificationTimeout);
        notificationTimeout = setTimeout(() => {
            notificationArea.style.display = 'none';
        }, duration);
    }

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

        const readPromises = Array.from(files).map(file => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const rawData = e.target.result;
                    if (rawData.byteLength < TOP_HEADER_SIZE) {
                        console.error(`File ${file.name} is smaller than the minimum header size.`);
                        // Optionally, alert the user or skip the file.
                        return resolve(null); // Resolve with null to filter out later
                    }
                    // Page data is now the raw ArrayBuffer, paths are parsed on demand.
                    pages.push({
                        name: file.name,
                        rawData: rawData,
                        paths: null // Paths will be parsed when the page is selected
                    });
                    resolve(true);
                };
                reader.onerror = (e) => reject(e);
                reader.readAsArrayBuffer(file);
            });
        });

        Promise.all(readPromises).then(() => {
            renderPageList();
            if (currentPageIndex === -1 && pages.length > 0) {
                switchPage(0);
            } else {
                // If pages were added, we might need to re-render the current one
                // but switchPage already handles this.
                switchPage(currentPageIndex);
            }
        });
    }

    // --- TOP File Parser ---

    const TOP_HEADER_SIZE = 32;
    const TOP_PACKET_SIZE = 6;
    const TOP_HEIGHT = 12000;

    function parsePageData(page) {
        // If paths are already parsed, do nothing.
        if (page.paths) return;

        const view = new DataView(page.rawData);
        const paths = [];
        let currentPathPoints = [];
        let pathStartOffset = -1;

        for (let offset = TOP_HEADER_SIZE; offset + TOP_PACKET_SIZE <= view.byteLength; offset += TOP_PACKET_SIZE) {
            // Mark the start of a new path segment
            if (pathStartOffset === -1) {
                pathStartOffset = offset;
            }

            const penStatus = view.getUint8(offset);
            const y = view.getInt16(offset + 1, true); // true for little-endian
            const x = view.getInt16(offset + 3, true); // true for little-endian

            currentPathPoints.push({ x, y: TOP_HEIGHT - y });

            // If pen-up, the path segment is complete.
            if (penStatus === 0) {
                const pathLength = offset - pathStartOffset + TOP_PACKET_SIZE;
                paths.push({
                    points: currentPathPoints,
                    offset: pathStartOffset,
                    length: pathLength,
                });
                // Reset for the next path
                currentPathPoints = [];
                pathStartOffset = -1;
            }
        }
        page.paths = paths;
    }

    // --- Page Switching ---

    // --- Page List Rendering ---

    function renderPageList() {
        pageList.innerHTML = ''; // Clear existing list
        closeContextMenu(); // Close any open context menus

        pages.forEach((page, index) => {
            const listItem = document.createElement('li');
            listItem.dataset.index = index;
            listItem.draggable = true;

            if (index === currentPageIndex) {
                listItem.classList.add('active');
            }

            // Make the entire list item clickable, not just the text
            listItem.addEventListener('click', () => switchPage(index));

            const pageName = document.createElement('span');
            pageName.className = 'page-name';
            pageName.textContent = page.name;

            const menuButton = document.createElement('button');
            menuButton.className = 'context-menu-button';
            menuButton.innerHTML = '&#x22EE;'; // Vertical ellipsis
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
            // If the list is now empty
            if (pages.length === 0) {
                currentPageIndex = -1;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                renderPageList();
                updateThumbs();
                return;
            }
            // If the index is invalid, select the nearest valid one
            index = Math.max(0, Math.min(index, pages.length - 1));
        }

        currentPageIndex = index;
        const page = pages[currentPageIndex];

        // This is the core of on-demand parsing.
        // The function will only parse if page.paths is null.
        parsePageData(page);

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
    let isTouching = false;
    let lastTouch = { x: 0, y: 0 };
    let initialPinchDistance = 0;
    let splitPreview = null; // Holds info for split preview: { index, splitPoint }
    let mergePreview = null; // Holds temporary data for merge preview


    function resizeCanvas() {
        const containerWidth = canvasContainer.clientWidth;
        const containerHeight = canvasContainer.clientHeight;

        // Set canvas drawing buffer size
        canvas.width = containerWidth;
        canvas.height = containerHeight;

        drawCurrentPage();
    canvas.style.visibility = 'visible';
    }

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvasContainer);


    function drawCurrentPage() {
        if (currentPageIndex < 0 || currentPageIndex >= pages.length) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const page = pages[currentPageIndex];
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
        const isSplitPreview = splitPreview && splitPreview.index === currentPageIndex;
        // The page object itself is now the source of truth.
        // Previews will temporarily replace page.paths for rendering.
        const pathsToRender = page.paths || [];

        pathsToRender.forEach((path, i) => {
            if (path.points.length > 0) {
                let strokeStyle = 'black'; // Default
                const isSelected = i >= selectionMin && i < selectionMax;

                // Determine style based on state (previews take precedence)
                if (isSplitPreview && splitPreview.index === currentPageIndex) {
                    const splitPoint = splitPreview.splitPoint;
                    strokeStyle = i < splitPoint ? 'blue' : 'red';
                } else if (isMergePreview && mergePreview.index === currentPageIndex) {
                    strokeStyle = 'purple';
                } else if (isSelected) {
                    strokeStyle = 'blue';
                }

                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = isSelected ? baseLineWidth * 3 : baseLineWidth;
                ctx.beginPath();
                ctx.moveTo(path.points[0].x, path.points[0].y);
                for (let j = 1; j < path.points.length; j++) {
                    ctx.lineTo(path.points[j].x, path.points[j].y);
                }
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    function splitPage(index) {
        const page = pages[index];
        const splitPoint = selectionMin; // This is the index of the first path for page 'b'

        // Set up preview state and redraw. The preview is now just visual.
        splitPreview = { index, splitPoint };
        drawCurrentPage();

        const message = `Split this page into two? Page "a" will have ${splitPoint} paths (blue), and page "b" will have ${page.paths.length - splitPoint} paths (red).`;

        setTimeout(() => {
            const confirmed = window.confirm(message);
            splitPreview = null; // Clear preview state regardless of choice

            if (confirmed) {
                const originalName = page.name.replace(/.top$/i, '');

                // Get the raw data segments for each new page
                const pathsA = page.paths.slice(0, splitPoint);
                const pathsB = page.paths.slice(splitPoint);

                const createNewRawData = (paths) => {
                    if (paths.length === 0) return null;
                    const dataSegments = paths.map(p => page.rawData.slice(p.offset, p.offset + p.length));
                    const totalDataLength = dataSegments.reduce((sum, s) => sum + s.byteLength, 0);

                    const newRawData = new ArrayBuffer(TOP_HEADER_SIZE + totalDataLength);
                    const newView = new Uint8Array(newRawData);
                    newView.set(new Uint8Array(page.rawData.slice(0, TOP_HEADER_SIZE)), 0); // Copy header

                    let currentOffset = TOP_HEADER_SIZE;
                    for (const segment of dataSegments) {
                        newView.set(new Uint8Array(segment), currentOffset);
                        currentOffset += segment.byteLength;
                    }
                    return newRawData;
                };

                const rawDataA = createNewRawData(pathsA);
                const rawDataB = createNewRawData(pathsB);

                const newPages = [];
                if (rawDataA) {
                    newPages.push({
                        name: `${originalName}-a.top`,
                        rawData: rawDataA,
                        paths: null // Re-parse on demand
                    });
                }
                if (rawDataB) {
                    newPages.push({
                        name: `${originalName}-b.top`,
                        rawData: rawDataB,
                        paths: null // Re-parse on demand
                    });
                }

                if (newPages.length > 0) {
                    pages.splice(index, 1, ...newPages);
                    switchPage(index); // Switch to the first new page
                } else {
                    // This case might happen if the split results in two empty pages,
                    // effectively deleting the original.
                    pages.splice(index, 1);
                    switchPage(Math.max(0, index - 1));
                }

            } else {
                // If cancelled, just redraw to remove the preview colors
                drawCurrentPage();
            }
        }, 10);
    }


    // --- Context Menu ---
    let contextMenu = null;

    function showContextMenu(button, pageIndex) {
        closeContextMenu();

        const rect = button.getBoundingClientRect();
        contextMenu = document.createElement('ul');
        contextMenu.className = 'context-menu';
        contextMenu.style.position = 'absolute';
        contextMenu.style.top = `${rect.bottom}px`;
        contextMenu.style.left = `${rect.left}px`;

        const createMenuItem = (text, action, disabled = false) => {
            const item = document.createElement('li');
            item.textContent = text;
            if (disabled) {
                item.classList.add('disabled');
            } else {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    action();
                    closeContextMenu();
                });
            }
            return item;
        };

        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pages.length - 1;
        const page = pages[pageIndex];
        // Ensure paths are parsed before checking their length
        parsePageData(page);
        const totalPaths = page.paths ? page.paths.length : 0;

        // Condition for splitting: min thumb is between the start and end, and selection range is zero
        const canSplit = selectionMin > 0 && selectionMin < totalPaths && selectionMin === selectionMax;

        contextMenu.appendChild(
            createMenuItem('Move Page Up', () => movePage(pageIndex, pageIndex - 1), isFirstPage)
        );
        contextMenu.appendChild(
            createMenuItem('Move Page Down', () => movePage(pageIndex, pageIndex + 1), isLastPage)
        );
        contextMenu.appendChild(document.createElement('hr'));
        contextMenu.appendChild(
            createMenuItem('Merge Page Up', () => mergePage(pageIndex, 'up'), isFirstPage)
        );
        contextMenu.appendChild(
            createMenuItem('Merge Page Down', () => mergePage(pageIndex, 'down'), isLastPage)
        );
        contextMenu.appendChild(document.createElement('hr'));
        contextMenu.appendChild(
            createMenuItem('Split Page', () => splitPage(pageIndex), !canSplit)
        );
        contextMenu.appendChild(document.createElement('hr'));
        contextMenu.appendChild(createMenuItem('Rename Page', () => startRenaming(pageIndex)));
        contextMenu.appendChild(document.createElement('hr'));
        contextMenu.appendChild(createMenuItem('Delete Page', () => deletePage(pageIndex)));

        document.body.appendChild(contextMenu);
    }

    function closeContextMenu() {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    }

    window.addEventListener('click', (e) => {
        // Close context menu if click is outside
        if (contextMenu && !contextMenu.contains(e.target) && !e.target.classList.contains('context-menu-button')) {
            closeContextMenu();
        }

        // Close user dropdown if click is outside
        if (userDropdown.style.display === 'block' && !userMenu.contains(e.target)) {
            userDropdown.style.display = 'none';
        }
    });

    const handleLoad = async () => {
        if (!await ensureLoggedIn()) {
            return;
        }

        const userDocsRef = collection(db, "users", currentUser.uid, "documents");
        const querySnapshot = await getDocs(userDocsRef);

        if (querySnapshot.empty) {
            showNotification("No saved documents found.");
            return;
        }

        const docList = querySnapshot.docs.map(d => d.id);
        const docNameToLoad = prompt("Enter the name of the document to load:\n\n" + docList.join("\n"));

        if (docNameToLoad && docList.includes(docNameToLoad)) {
            const loadIcon = loadButton.querySelector('svg');
            try {
                loadButton.disabled = true;
                loadIcon.classList.add('spinner');

                const docRef = doc(db, "users", currentUser.uid, "documents", docNameToLoad);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const docData = docSnap.data();

                    const loadedPages = docData.pages.map(pageContent => {
                        const byteString = atob(pageContent.data);
                        const compressedData = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(compressedData);
                        for (let i = 0; i < byteString.length; i++) {
                            ia[i] = byteString.charCodeAt(i);
                        }

                        // Decompress the data after loading
                        const rawData = decompressPointsWithHeader(compressedData);

                        return {
                            name: pageContent.name,
                            rawData: rawData,
                            paths: null // Parse on demand
                        };
                    });

                    const isSessionEmpty = pages.length === 0;

                    if (isSessionEmpty) {
                        pages.push(...loadedPages);
                        documentTitle.textContent = docNameToLoad;
                        renderPageList();
                        switchPage(0);
                    } else {
                        const replace = confirm("Do you want to replace the current pages or append the new ones?");
                        if (replace) {
                            pages.length = 0;
                            pages.push(...loadedPages);
                            documentTitle.textContent = docNameToLoad;
                            renderPageList();
                            switchPage(0);
                        } else {
                            const startIndex = pages.length;
                            pages.push(...loadedPages);
                            const useNewName = confirm(`Document loaded. Keep current name "${documentTitle.textContent}" or use new name "${docNameToLoad}"?`);
                            if (useNewName) {
                                documentTitle.textContent = docNameToLoad;
                            }
                            renderPageList();
                            switchPage(startIndex);
                        }
                    }
                } else {
                    showNotification("Document not found.");
                }
            } catch (error) {
                console.error("Error loading document:", error);
                showNotification("Failed to load document. Please check the console for details.");
            } finally {
                loadButton.disabled = false;
                loadIcon.classList.remove('spinner');
            }
        } else if (docNameToLoad) {
            alert(`Document "${docNameToLoad}" not found.`);
        }
    });


    // --- User Interaction for Pan and Zoom ---

    contentSection.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
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
            panX -= e.deltaY;
        } else {
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

    canvasContainer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isTouching = true;
        if (e.touches.length === 1) {
            lastTouch.x = e.touches[0].clientX;
            lastTouch.y = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            initialPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    });

    canvasContainer.addEventListener('touchend', (e) => {
        e.preventDefault();
        // After a finger is lifted, e.touches shows the remaining fingers
        if (e.touches.length < 2) {
            initialPinchDistance = 0; // Stop zooming
        }
        if (e.touches.length === 1) {
            // If one finger remains, reset panning start point to prevent a jump
            lastTouch.x = e.touches[0].clientX;
            lastTouch.y = e.touches[0].clientY;
        } else if (e.touches.length === 0) {
            // No fingers left
            isTouching = false;
        }
    });

    canvasContainer.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!isTouching) return;

        if (e.touches.length === 1) {
            const dx = e.touches[0].clientX - lastTouch.x;
            const dy = e.touches[0].clientY - lastTouch.y;
            panX += dx;
            panY += dy;
            lastTouch.x = e.touches[0].clientX;
            lastTouch.y = e.touches[0].clientY;
        } else if (e.touches.length === 2 && initialPinchDistance > 0) {
            const currentPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const zoomFactor = currentPinchDistance / initialPinchDistance;

            const rect = canvasContainer.getBoundingClientRect();
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            const mouseBeforeZoomX = (centerX - panX) / scale;
            const mouseBeforeZoomY = (centerY - panY) / scale;

            scale *= zoomFactor;

            const mouseAfterZoomX = (centerX - panX) / scale;
            const mouseAfterZoomY = (centerY - panY) / scale;

            panX += (mouseAfterZoomX - mouseBeforeZoomX) * scale;
            panY += (mouseAfterZoomY - mouseBeforeZoomY) * scale;

            initialPinchDistance = currentPinchDistance;
        }
        drawCurrentPage();
    });

    // --- Selection Bar Interaction ---

    function updateThumbs() {
        if (currentPageIndex < 0) return;
        const page = pages[currentPageIndex];
        const totalPaths = page.paths ? page.paths.length : 0;
        if (totalPaths === 0) {
            minThumb.style.top = '0%';
            maxThumb.style.top = '0%';
            return;
        }
        const minPercent = (selectionMin / totalPaths) * 100;
        const maxPercent = (selectionMax / totalPaths) * 100;
        minThumb.style.top = `${minPercent}%`;
        maxThumb.style.top = `${maxPercent}%`;
    }

    let activeThumb = null;

    function onThumbMouseDown(event) {
        activeThumb = event.target === minThumb ? minThumb : maxThumb;
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
        const totalPaths = page.paths ? page.paths.length : 0;
        if (totalPaths <= 1) return;
        const barRect = selectionBar.getBoundingClientRect();
        const offsetY = event.clientY - barRect.top;
        const percent = Math.max(0, Math.min(100, (offsetY / barRect.height) * 100));
        const value = Math.round((totalPaths * percent) / 100);
        if (activeThumb === minThumb) {
            selectionMin = Math.min(value, selectionMax);
        } else {
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
        let step = 0;
        if (event.key === 'ArrowUp') step = -1;
        else if (event.key === 'ArrowDown') step = 1;
        else if (event.key === 'PageUp') step = -100;
        else if (event.key === 'PageDown') step = 100;
        if (step === 0 || currentPageIndex < 0) return;
        event.preventDefault();
        const page = pages[currentPageIndex];
        const totalPaths = page.paths ? page.paths.length : 0;
        if (thumb === minThumb) {
            selectionMin = Math.max(0, Math.min(selectionMin + step, selectionMax));
        } else {
            selectionMax = Math.max(selectionMin, Math.min(selectionMax + step, totalPaths));
        }
        updateThumbs();
        drawCurrentPage();
    }

    minThumb.addEventListener('keydown', handleThumbKeyDown);
    maxThumb.addEventListener('keydown', handleThumbKeyDown);

    // --- Page Reordering ---

    function movePage(oldIndex, newIndex) {
        if (newIndex < 0 || newIndex >= pages.length || oldIndex === newIndex) return;

        const [movedPage] = pages.splice(oldIndex, 1);
        pages.splice(newIndex, 0, movedPage);

        if (currentPageIndex === oldIndex) {
            currentPageIndex = newIndex;
        } else if (currentPageIndex > oldIndex && currentPageIndex <= newIndex) {
            currentPageIndex--;
        } else if (currentPageIndex < oldIndex && currentPageIndex >= newIndex) {
            currentPageIndex++;
        }
        renderPageList();
    }

    function mergePage(index, direction) {
        const otherIndex = direction === 'up' ? index - 1 : index + 1;
        if (otherIndex < 0 || otherIndex >= pages.length) return;

        const topPage = direction === 'up' ? pages[otherIndex] : pages[index];
        const bottomPage = direction === 'up' ? pages[index] : pages[otherIndex];
        const topIndex = Math.min(index, otherIndex);

        // Ensure both pages have their paths parsed for preview and merging.
        parsePageData(topPage);
        parsePageData(bottomPage);

        // Create a temporary merged set of paths for preview.
        const mergedPaths = (topPage.paths || []).concat(bottomPage.paths || []);

        // Use a temporary object for the preview data
        const tempPreviewPage = {
            paths: mergedPaths
        };

        mergePreview = { index: topIndex, data: tempPreviewPage };
        drawCurrentPage();

        const message = `Are you sure you want to merge "${topPage.name}" and "${bottomPage.name}"?`;

        setTimeout(async () => {
            const confirmed = window.confirm(message);
            mergePreview = null; // Clear preview state

            if (confirmed) {
                let finalHeader = topPage.rawData.slice(0, TOP_HEADER_SIZE);
                // Compare headers by converting them to strings
                const topHeaderStr = String.fromCharCode.apply(null, new Uint8Array(topPage.rawData.slice(0, TOP_HEADER_SIZE)));
                const bottomHeaderStr = String.fromCharCode.apply(null, new Uint8Array(bottomPage.rawData.slice(0, TOP_HEADER_SIZE)));

                if (topHeaderStr !== bottomHeaderStr) {
                    let choice = prompt(`The headers of "${topPage.name}" and "${bottomPage.name}" are different. Which header do you want to use? Type 'top' or 'bottom'.`, 'top');
                    while(choice && choice.toLowerCase() !== 'top' && choice.toLowerCase() !== 'bottom') {
                        choice = prompt(`Invalid choice. Please type 'top' or 'bottom'.`, 'top');
                    }
                    if (choice && choice.toLowerCase() === 'bottom') {
                        finalHeader = bottomPage.rawData.slice(0, TOP_HEADER_SIZE);
                    }
                }

                const topData = topPage.rawData.slice(TOP_HEADER_SIZE);
                const bottomData = bottomPage.rawData.slice(TOP_HEADER_SIZE);

                const newRawData = new ArrayBuffer(TOP_HEADER_SIZE + topData.byteLength + bottomData.byteLength);
                const newView = new Uint8Array(newRawData);
                newView.set(new Uint8Array(finalHeader), 0);
                newView.set(new Uint8Array(topData), TOP_HEADER_SIZE);
                newView.set(new Uint8Array(bottomData), TOP_HEADER_SIZE + topData.byteLength);

                const newName = `${topPage.name.replace(/.top$/i, '')}-${bottomPage.name.replace(/.top$/i, '')}.top`;
                const mergedPage = {
                    name: newName,
                    rawData: newRawData,
                    paths: null // Will be re-parsed on next selection
                };

                pages.splice(topIndex, 2, mergedPage);
                switchPage(topIndex); // Switch to the new merged page
            } else {
                drawCurrentPage(); // Redraw to restore the original view
            }
        }, 10);
    }

    let draggedIndex = null;

    function addDragDropListeners() {
        const listItems = Array.from(pageList.querySelectorAll('li'));

        const clearIndicators = () => {
            listItems.forEach(i => i.classList.remove('drop-indicator-top', 'drop-indicator-bottom'));
        };

        listItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('context-menu-button')) {
                    e.preventDefault();
                    return;
                }
                const draggedItem = e.currentTarget;
                draggedIndex = parseInt(draggedItem.dataset.index, 10);
                setTimeout(() => draggedItem.classList.add('dragging'), 0);
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                clearIndicators();
                item.classList.remove('dragging');
                draggedIndex = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const rect = item.getBoundingClientRect();
                const isAfter = e.clientY > rect.top + rect.height / 2;

                // Clear previous indicators before setting a new one
                clearIndicators();

                if (isAfter) {
                    item.classList.add('drop-indicator-bottom');
                } else {
                    item.classList.add('drop-indicator-top');
                }
            });

            item.addEventListener('dragleave', () => {
                // This event is tricky, a global clear on dragend/drop is more reliable
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const rect = item.getBoundingClientRect();
                const isAfter = e.clientY > rect.top + rect.height / 2;
                let targetIndex = parseInt(item.dataset.index, 10);

                clearIndicators();

                if (draggedIndex === null || draggedIndex === targetIndex) return;

                if (isAfter) {
                    targetIndex++;
                }
                if (draggedIndex < targetIndex) {
                    targetIndex--;
                }

                movePage(draggedIndex, targetIndex);
            });
        });

        // A final cleanup listener on the parent
        pageList.addEventListener('dragend', clearIndicators);
        pageList.addEventListener('dragleave', (e) => {
            if (e.target === pageList) {
                clearIndicators();
            }
        });
    }

    // --- Deletion Handling ---

    function deletePage(index) {
        if (index < 0 || index >= pages.length) return false;
        const pageName = pages[index].name;
        const confirmed = window.confirm(`Are you sure you want to delete the page "${pageName}"?`);
        if (confirmed) {
            pages.splice(index, 1);
            if (currentPageIndex === index) {
                switchPage(Math.max(0, index - 1));
            } else if (currentPageIndex > index) {
                switchPage(currentPageIndex - 1);
            } else {
                renderPageList();
            }
            return true;
        }
        return false;
    }

    function handleDeleteKey(event) {
        if (event.key !== 'Delete' || currentPageIndex < 0) return;

        const page = pages[currentPageIndex];
        if (!page) return;

        if (selectionMin < selectionMax) {
            // A selection of paths is to be deleted
            const confirmed = window.confirm(`Are you sure you want to delete ${selectionMax - selectionMin} selected path(s)?`);
            if (confirmed) {
                const pathsToDelete = new Set(page.paths.slice(selectionMin, selectionMax));
                const remainingPaths = page.paths.filter(p => !pathsToDelete.has(p));

                if (remainingPaths.length === 0) {
                    // If all paths are deleted, just delete the page
                    deletePage(currentPageIndex);
                } else {
                    // Rebuild the rawData from the remaining paths
                    const remainingDataSize = remainingPaths.reduce((sum, p) => sum + p.length, 0);
                    const newRawData = new ArrayBuffer(TOP_HEADER_SIZE + remainingDataSize);
                    const newView = new Uint8Array(newRawData);

                    newView.set(new Uint8Array(page.rawData.slice(0, TOP_HEADER_SIZE)), 0);
                    let currentOffset = TOP_HEADER_SIZE;
                    remainingPaths.forEach(path => {
                        const segment = page.rawData.slice(path.offset, path.offset + path.length);
                        newView.set(new Uint8Array(segment), currentOffset);
                        currentOffset += segment.byteLength;
                    });

                    // Update page in-place
                    page.rawData = newRawData;
                    page.paths = null; // Force re-parsing

                    selectionMax = selectionMin; // Reset selection

                    // Re-parse and redraw
                    switchPage(currentPageIndex);
                }
            }
        } else {
            // No selection, so delete the entire page
            deletePage(currentPageIndex);
        }
    }

    window.addEventListener('keydown', handleDeleteKey);

    // --- Printing ---

    function printAllPages() {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;';
        document.body.appendChild(iframe);
        const printDoc = iframe.contentWindow.document;
        printDoc.write(`<!DOCTYPE html><html><head><title>Print</title><style>
            @page { size: A4 portrait; margin: 0; }
            body { margin: 0; }
            .page-container { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; }
            .page-container:last-child { page-break-after: avoid; }
            canvas { width: 100%; height: 100%; }
        </style></head><body></body></html>`);
        const printBody = printDoc.body;
        pages.forEach(page => {
            const pageContainer = printDoc.createElement('div');
            pageContainer.className = 'page-container';
            const printCanvas = printDoc.createElement('canvas');
            const printCtx = printCanvas.getContext('2d');
            const printWidth = 2480;
            const printHeight = 3508;
            printCanvas.width = printWidth;
            printCanvas.height = printHeight;
            printCtx.fillStyle = 'white';
            printCtx.fillRect(0, 0, printWidth, printHeight);
            const contentScale = printWidth / 8800;
            printCtx.scale(contentScale, contentScale);
            printCtx.lineWidth = 5;
            printCtx.strokeStyle = 'black';
            // Ensure paths are parsed before printing
            parsePageData(page);
            (page.paths || []).forEach(path => {
                if (path.points.length > 0) {
                    printCtx.beginPath();
                    printCtx.moveTo(path.points[0].x, path.points[0].y);
                    for (let j = 1; j < path.points.length; j++) {
                        printCtx.lineTo(path.points[j].x, path.points[j].y);
                    }
                    printCtx.stroke();
                }
            });
            pageContainer.appendChild(printCanvas);
            printBody.appendChild(pageContainer);
        });
        printDoc.close();
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 500);
    }

    window.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            printAllPages();
        } else if (e.key === 'F2' && currentPageIndex !== -1) {
            e.preventDefault();
            startRenaming(currentPageIndex);
        }
    });

    function startRenaming(index) {
        closeContextMenu();
        const listItem = pageList.querySelector(`li[data-index='${index}']`);
        if (!listItem) return;

        const pageNameSpan = listItem.querySelector('.page-name');
        const oldName = pages[index].name;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldName;
        input.className = 'page-name-input'; // For potential styling
        input.style.width = '100%'; // Ensure it fills the space
        input.addEventListener('blur', finishRenaming);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // Trigger blur to save
            } else if (e.key === 'Escape') {
                // Restore old name and blur
                input.value = oldName;
                input.blur();
            }
        });

        function finishRenaming() {
            // Clean up listeners
            input.removeEventListener('blur', finishRenaming);

            const newName = input.value.trim();
            if (newName && newName !== oldName) {
                pages[index].name = newName;
            }

            // Re-render the single item to restore the span
            renderPageList(); // Simplest way to refresh the view
        }

        pageNameSpan.replaceWith(input);
        input.focus();
        input.select();
    }


    const blobToBase64 = (blob) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                // The result includes the data URL prefix (e.g., "data:application/octet-stream;base64,"),
                // which we need to strip off to get only the base64 string.
                resolve(reader.result.split(',')[1]);
            };
            reader.onerror = reject;
        });
    };

    // --- Firebase Authentication ---
    const { auth, db, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } = window.firebase;
    let currentUser = null;

    async function ensureLoggedIn() {
        if (currentUser) {
            return true;
        }

        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            return !!auth.currentUser;
        } catch (error) {
            console.error("Authentication failed:", error);
            showNotification("Login failed. Please check the console for details.");
            return false;
        }
    }

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            // User is signed in
            loginButton.style.display = 'none';
            userMenu.style.display = 'block';
            userAvatar.src = user.photoURL;
            documentTitle.textContent = user.displayName ? `${user.displayName}'s Document` : 'Untitled Document';
        } else {
            // User is signed out
            loginButton.style.display = '';
            userMenu.style.display = 'none';
            documentTitle.textContent = 'Untitled Document';
        }
    });

    loginButton.addEventListener('click', async () => {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Authentication failed:", error);
            showNotification("Login failed. Please check the console for details.");
        }
    });

    logoutButton.addEventListener('click', async () => {
        await signOut(auth);
        userDropdown.style.display = 'none';
    });

    switchUserButton.addEventListener('click', async () => {
        try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Authentication failed:", error);
            showNotification("Login failed. Please check the console for details.");
        } finally {
            userDropdown.style.display = 'none';
        }
    });

    userAvatar.addEventListener('click', () => {
        userDropdown.style.display = userDropdown.style.display === 'block' ? 'none' : 'block';
    });

    // --- Firebase Firestore & Storage ---
    const { doc, setDoc, getDoc, collection, getDocs } = window.firebase;
    const handleSave = async () => {
        if (!await ensureLoggedIn()) {
            return;
        }
        if (pages.length === 0) {
            showNotification("There are no pages to save.");
            return;
        }

        const docName = prompt("Enter a name for your document:", documentTitle.textContent);
        if (!docName) return;

        const saveIcon = saveButton.querySelector('svg');
        try {
            saveButton.disabled = true;
            saveIcon.classList.add('spinner');

            const pageDataPromises = pages.map(async (page) => {
                // Compress the rawData before saving
                const compressedData = compressPointsWithHeader(page.rawData);
                const topFileBlob = new Blob([compressedData], { type: 'application/octet-stream' });
                const base64Data = await blobToBase64(topFileBlob);
                return { name: page.name, data: base64Data };
            });

            const pageContents = await Promise.all(pageDataPromises);

            const docData = {
                pages: pageContents,
                createdAt: new Date()
            };

            const userDocRef = doc(db, "users", currentUser.uid, "documents", docName);
            await setDoc(userDocRef, docData);

            documentTitle.textContent = docName;
            showNotification(`Document "${docName}" saved successfully.`);

        } catch (error) {
            console.error("Error saving document:", error);
            showNotification("Failed to save document. Please check the console for details.");
        } finally {
            saveButton.disabled = false;
            saveIcon.classList.remove('spinner');
        }
    });

    function startDocumentRename() {
        const oldTitle = documentTitle.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldTitle;
        input.className = 'page-name-input'; // Reuse existing styles if applicable

        const finishEditing = () => {
            const newTitle = input.value.trim();
            documentTitle.textContent = (newTitle && newTitle !== oldTitle) ? newTitle : oldTitle;
            input.replaceWith(documentTitle);
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = oldTitle;
                input.blur();
            }
        });

        documentTitle.replaceWith(input);
        input.focus();
        input.select();
    }

    renameButton.addEventListener('click', startDocumentRename);

    loadButton.addEventListener('click', handleLoad);
    dropdownLoadButton.addEventListener('click', (e) => {
        e.preventDefault();
        handleLoad();
        userDropdown.style.display = 'none';
    });

    saveButton.addEventListener('click', handleSave);
    dropdownSaveButton.addEventListener('click', (e) => {
        e.preventDefault();
        handleSave();
        userDropdown.style.display = 'none';
    });

    menuButton.addEventListener('click', () => {
        const isVisible = indexSection.classList.contains('force-show') ||
                          (window.innerWidth > 768 && !indexSection.classList.contains('force-hide'));

        if (window.innerWidth > 768) {
            // Desktop
            if (isVisible) {
                indexSection.classList.add('force-hide');
                indexSection.classList.remove('force-show');
            } else {
                indexSection.classList.remove('force-hide');
            }
        } else {
            // Mobile
            if (isVisible) {
                indexSection.classList.remove('force-show');
            } else {
                indexSection.classList.add('force-show');
            }
        }
    });

    // Initial setup
    resizeCanvas();
    canvasContainer.style.cursor = 'grab';

    /**
     * Компресира .top данни (ArrayBuffer), запазвайки 32-байтовия хедър и използвайки:
     * - 2-байтов Compact Delta (MSB=1) за малки промени (Status!=0).
     * - 1-байтов (0x00) за Status=0 точки.
     * - 6-байтов Full Point (MSB=0, Bit 6=1) за други Status!=0.
     *
     * @param {ArrayBuffer} fileBuffer - Некомпресираното съдържание на .top файла (с хедър).
     * @returns {ArrayBuffer} Компресирани данни (с хедър).
     */
    function compressPointsWithHeader(fileBuffer) {
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

        // 1. Копиране на Хедъра (първите 32 байта)
        const headerBuffer = fileBytes.slice(0, headerSize);
        compressedChunks.push(headerBuffer.buffer);

        // 2. Обработка на точките
        for (let i = 0; i < numPoints; i++) {
            const offset = i * 6;

            const status = pointDataView.getUint8(offset);
            const currentX = pointDataView.getInt16(offset + 1, true); // Int16
            const currentY = pointDataView.getInt16(offset + 3, true); // Int16
            const currentP = pointDataView.getUint8(offset + 5);

            if (status != 0) { // Писалката е спусната (Status=1 или други стойности)

                if (!isPathStarted) {
                    // Първа точка от път: Винаги Full Point (MSB=0) - 6 байта
                    const blockView = createBlock(6);

                    let firstByte = status & 0x7f;
                    if(status & 0x80)
                        firstByte |= 0x40; // Бит 7 -> Бит 6

                    blockView.setUint8(0, firstByte);
                    blockView.setInt16(1, currentX, true);
                    blockView.setInt16(3, currentY, true);
                    blockView.setUint8(5, currentP);
                    compressedChunks.push(blockView.buffer);

                    isPathStarted = true;

                } else {
                    // Продължение на път: Опит за Compact Delta
                    const deltaX = currentX - previousX;
                    const deltaY = currentY - previousY;
                    const deltaP = currentP - previousP;

                    // Проверка за Compact Delta: |dX| < 32, |dY| < 32, |dP| < 4
                    const isCompact = Math.abs(deltaX) < 32 &&
                                      Math.abs(deltaY) < 32 &&
                                      Math.abs(deltaP) < 4;

                    if (isCompact) {
                        // 2-байтов Компактен Блок (MSB=1)
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
                        // Full Point (MSB=0) - 6 байта
                        const blockView = createBlock(6);

                        let firstByte = status & 0x7f;
                        if(status & 0x80)
                            firstByte |= 0x40; // Бит 7 -> Бит 6

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

            } else { // Status=0: Писалката е вдигната
                // 1-байтов блок: 0x00
                const blockView = createBlock(1);
                blockView.setUint8(0, 0);
                compressedChunks.push(blockView.buffer);

                isPathStarted = false;
            }
        }

        // 3. Свързване на всички компресирани блокове и връщане на ArrayBuffer
        const totalLength = compressedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const finalCompressedBuffer = new Uint8Array(totalLength);
        let outOffset = 0;
        for (const chunk of compressedChunks) {
            finalCompressedBuffer.set(new Uint8Array(chunk), outOffset);
            outOffset += chunk.byteLength;
        }

        return finalCompressedBuffer.buffer;
    }

    /**
     * Декомпресира .top данни (ArrayBuffer), кодирани с 6Б/2Б/1Б схема, и връща
     * некомпресирания файл (ArrayBuffer) с хедър.
     *
     * @param {ArrayBuffer} compressedBuffer - Компресираните данни (с хедър).
     * @returns {ArrayBuffer} Декомпресирани 6-байтови точки (с хедър).
     */
    function decompressPointsWithHeader(compressedBuffer) {
        // getSignedValue и createPoint трябва да са дефинирани и достъпни
        const getSignedValue = (value, bitCount) => {
            const signBit = 1 << (bitCount - 1);
            if (value & signBit) return value - (1 << bitCount);
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


        const compressedView = new DataView(compressedBuffer);
        const decompressedPoints = [];
        const headerSize = 32;

        // 1. Извличане на хедъра
        const compressedBytes = new Uint8Array(compressedBuffer);
        const headerBuffer = compressedBytes.slice(0, headerSize).buffer;

        let offset = headerSize;
        let previousX = 0;
        let previousY = 0;
        let previousP = 0;

        while (offset < compressedBuffer.byteLength) {
            const byte1 = compressedView.getUint8(offset);

            const isCompact = (byte1 & 0x80) === 0x80; // MSB=1
            const isStatusZeroByte = byte1 === 0x00; // 1-байтов 0x00

            let currentX, currentY, currentP, status;
            let consumedBytes = 0;

            if (isStatusZeroByte) {
                consumedBytes = 1;

                if (decompressedPoints.length === 0) {
                    offset += consumedBytes;
                    continue;
                }
                // Status=0: използва се последната декомпресирана точка
                currentX = previousX;
                currentY = previousY;
                currentP = previousP;
                status = 0;

            } else if (isCompact) { // MSB=1: Compact Delta (2 байта)
                consumedBytes = 2;
                const byte2 = compressedView.getUint8(offset + 1);

                // Декодиране на 2-байтовия блок
                const dxEncoded = (byte1 >> 1) & 0x3F;
                const deltaX = getSignedValue(dxEncoded, 6);
                const dyUpper = byte1 & 0x01;
                const dyLower = (byte2 >> 3) & 0x1F;
                const dyEncoded = (dyUpper << 5) | dyLower;
                const deltaY = getSignedValue(dyEncoded, 6);
                const dpEncoded = byte2 & 0x07;
                const deltaP = getSignedValue(dpEncoded, 3);

                // Възстановяване на пълните стойности
                currentX = previousX + deltaX;
                currentY = previousY + deltaY;
                currentP = previousP + deltaP;
                // Компактният блок винаги е Status=1, но при декомпресия се връща
                // оригиналният Status, който е 135 (0x87) по ваша логика.
                // Тъй като в компресията не кодираме Status, ще приемем 135 (0x80 | 0x01 | 0x04)
                // или 1 (LBS), като най-безопасно е да използваме 135, ако това е
                // очакваната стойност за Status=1 в оригиналния файл.
                status = 135;

            } else { // MSB=0 и не е 0x00: Full Point (6 байта)
                consumedBytes = 6;

                status = byte1;
                // Обръщане на 'MSB -> Бит 6' логиката: ако Бит 6 е 1, връщаме MSB=1
                if(status & 0x40) {
                    status |= 0x80;
                }
                status &= 0xBF; // Бит 6 винаги е 0 в оригиналния формат, след като се използва за флаг

                // Четем X/Y като Int16
                currentX = compressedView.getInt16(offset + 1, true);
                currentY = compressedView.getInt16(offset + 3, true);
                currentP = compressedView.getUint8(offset + 5);
            }

            // Актуализиране на предишните стойности
            previousX = currentX;
            previousY = currentY;
            previousP = currentP;

            // Добавяне на точката
            decompressedPoints.push(createPoint(status, currentX, currentY, currentP));

            // Преместване на офсета
            offset += consumedBytes;
        }

        // 2. Свързване на Хедъра с Декомпресираните Точки и връщане на ArrayBuffer
        const totalPointsLength = decompressedPoints.length * 6;
        const finalBuffer = new Uint8Array(headerSize + totalPointsLength);

        finalBuffer.set(new Uint8Array(headerBuffer), 0);

        let outOffset = headerSize;
        for (const chunk of decompressedPoints) {
            finalBuffer.set(new Uint8Array(chunk), outOffset);
            outOffset += 6;
        }

        return finalBuffer.buffer;
    }
});