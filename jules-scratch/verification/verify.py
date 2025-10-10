from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Get the absolute path to the HTML file
        html_file_path = os.path.abspath('index.html')

        # Go to the local HTML file
        page.goto(f'file://{html_file_path}')

        # Wait for the drop zone to be visible
        page.wait_for_selector('#drop-zone')

        # Upload a file
        page.locator('#file-input').set_input_files('dummy.top')

        # Wait for the first page to be loaded and drawn
        page.wait_for_function("() => window.pages && window.pages.length > 0 && window.currentPageIndex === 0", timeout=60000)

        # Move the max thumb
        max_thumb = page.locator('#max-thumb')
        bounding_box = max_thumb.bounding_box()
        page.mouse.move(bounding_box['x'] + bounding_box['width'] / 2, bounding_box['y'] + bounding_box['height'] / 2)
        page.mouse.down()
        page.mouse.move(bounding_box['x'] + bounding_box['width'] / 2, bounding_box['y'] + bounding_box['height'] / 2 + 200)
        page.mouse.up()

        # Take a screenshot
        page.screenshot(path='jules-scratch/verification/verification.png')

        browser.close()

run()