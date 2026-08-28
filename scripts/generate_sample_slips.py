"""Script to generate realistic test slip images for ANR Commercial Laundry."""

import os
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont


def create_sample_slip_image(
    client_name: str,
    date_str: str,
    slip_no: str,
    items: list,
    output_path: str,
):
    """Generates a realistic commercial laundry control slip image."""
    # Create image with paper texture / off-white background
    img = Image.new("RGB", (800, 1000), color=(250, 249, 246))
    draw = ImageDraw.Draw(img)

    # Draw header border
    draw.rectangle([(20, 20), (780, 980)], outline=(80, 80, 80), width=2)
    draw.line([(20, 120), (780, 120)], fill=(80, 80, 80), width=2)

    # Title
    draw.text((40, 35), "ANR COMMERCIAL LAUNDRY SERVICES", fill=(20, 20, 20))
    draw.text((40, 65), "DAILY LINEN CONTROL & RECONCILIATION SLIP", fill=(60, 60, 60))
    
    # Metadata Box
    draw.text((40, 135), f"CLIENT: {client_name}", fill=(10, 10, 10))
    draw.text((450, 135), f"DATE: {date_str}", fill=(10, 10, 10))
    draw.text((450, 160), f"SLIP NO: {slip_no}", fill=(10, 10, 10))

    # Table Header
    table_y = 200
    draw.rectangle([(30, table_y), (770, table_y + 35)], fill=(230, 230, 230), outline=(80, 80, 80))
    draw.text((40, table_y + 10), "ITEM DESCRIPTION", fill=(0, 0, 0))
    draw.text((380, table_y + 10), "PICKUP", fill=(0, 0, 0))
    draw.text((490, table_y + 10), "DELIVERY", fill=(0, 0, 0))
    draw.text((600, table_y + 10), "REMARKS", fill=(0, 0, 0))

    current_y = table_y + 45
    for item in items:
        raw_name = item.get("name", "")
        pickup = str(item.get("pickup", 0))
        deliv = str(item.get("delivery", 0))
        remarks = item.get("remarks", "-")

        # Row line
        draw.line([(30, current_y + 30), (770, current_y + 30)], fill=(200, 200, 200), width=1)
        
        # Handwritten-like simulation text
        draw.text((45, current_y + 5), raw_name, fill=(20, 30, 90))
        draw.text((400, current_y + 5), pickup, fill=(20, 30, 90))
        draw.text((510, current_y + 5), deliv, fill=(20, 30, 90))
        draw.text((610, current_y + 5), remarks, fill=(40, 40, 40))

        current_y += 40

    # Signatures
    draw.line([(50, 880), (250, 880)], fill=(80, 80, 80), width=1)
    draw.text((50, 890), "Client Signature / Stamp", fill=(70, 70, 70))

    draw.line([(520, 880), (720, 880)], fill=(80, 80, 80), width=1)
    draw.text((520, 890), "ANR Driver / Supervisor", fill=(70, 70, 70))

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "JPEG")
    print(f"Created sample slip image: {output_path}")


if __name__ == "__main__":
    sample_dir = os.path.join(os.path.dirname(__file__), "..", "samples")
    
    # Generate for Luxwood
    create_sample_slip_image(
        client_name="Luxwood Hotel & Suites",
        date_str="15/08/2026",
        slip_no="LX-20260815-01",
        items=[
            {"name": "B/Sheet Dbl", "pickup": 35, "delivery": 32, "remarks": "3 torn replaced"},
            {"name": "Bath Towel", "pickup": 50, "delivery": 50, "remarks": "OK"},
            {"name": "P/Case", "pickup": 70, "delivery": 68, "remarks": "Stained"},
            {"name": "Bath Mat", "pickup": 20, "delivery": 20, "remarks": "OK"},
        ],
        output_path=os.path.join(sample_dir, "luxwood_sample_slip_01.jpg"),
    )

    # Generate for The Lennox
    create_sample_slip_image(
        client_name="The Lennox Luxury Apartments",
        date_str="16/08/2026",
        slip_no="LX-20260816-02",
        items=[
            {"name": "King Duvet Cover", "pickup": 15, "delivery": 15, "remarks": "OK"},
            {"name": "Double Bedsheet", "pickup": 25, "delivery": 25, "remarks": "OK"},
            {"name": "Face Towel", "pickup": 40, "delivery": 38, "remarks": "2 missing"},
            {"name": "Pool Towel", "pickup": 30, "delivery": 30, "remarks": "OK"},
        ],
        output_path=os.path.join(sample_dir, "thelennox_sample_slip_02.jpg"),
    )
