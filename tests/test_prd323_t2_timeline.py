import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from opportunity_timeline import render_timeline

class TimelineTests(unittest.TestCase):
    def test_render(self):
        events = [{"created_at": "2026-11-08", "title": "测试机会", "status": "new"}]
        md = render_timeline(events)
        self.assertIn("测试机会", md)

if __name__ == "__main__":
    unittest.main()
