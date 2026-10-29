import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

with tempfile.TemporaryDirectory() as temp:
    pass

from main import app


class RandlyApiTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.db = str(Path(self.folder.name) / "test.sqlite")
        import main
        main.DB_PATH = self.db
        main.COOKIE_SECURE = False
        main._login_failures.clear()
        main.init_db()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.folder.cleanup()

    def test_room_access_and_unique_draws(self):
        guest = TestClient(app)
        result = self.client.post("/api/auth/register", json={"username":"host123","password":"verystrongpassword"})
        self.assertEqual(result.status_code, 201, result.text)
        room = self.client.post("/api/rooms", json={"title":"Classroom","min_value":1,"max_value":4,"no_repeats":True})
        self.assertEqual(room.status_code, 201, room.text)
        code = room.json()["code"]
        self.assertFalse(guest.get(f"/api/rooms/{code}").json()["is_host"])
        self.assertEqual(guest.post(f"/api/rooms/{code}/draw", json={}).status_code, 401)
        numbers = []
        for _ in range(4):
            draw = self.client.post(f"/api/rooms/{code}/draw", json={})
            self.assertEqual(draw.status_code, 200, draw.text)
            numbers.append(draw.json()["number"])
        self.assertEqual(set(numbers), {1,2,3,4})
        self.assertEqual(self.client.post(f"/api/rooms/{code}/draw",json={}).status_code,409)
        self.assertEqual(len(guest.get(f"/api/rooms/{code}").json()["history"]), 4)
        self.assertEqual(self.client.post(f"/api/rooms/{code}/reset",json={}).status_code,200)

    def test_account_login_and_preferences(self):
        self.client.post("/api/auth/register", json={"username":"Tester22","password":"verystrongpassword"})
        self.assertEqual(self.client.get("/api/auth/me").json()["username"],"Tester22")
        save=self.client.put("/api/me/preferences",json={"values":{"theme":"dark","presets":[1,2]}})
        self.assertEqual(save.status_code,200)
        self.assertEqual(self.client.get("/api/me/preferences").json()["values"]["theme"],"dark")
        self.client.post("/api/auth/logout",json={})
        self.assertEqual(self.client.get("/api/auth/me").status_code,401)
        wrong=self.client.post("/api/auth/login",json={"username":"Tester22","password":"incorrect"})
        self.assertEqual(wrong.status_code,401)
        correct=self.client.post("/api/auth/login",json={"username":"Tester22","password":"verystrongpassword"})
        self.assertEqual(correct.status_code,200)
        self.assertEqual(self.client.get("/api/auth/me").status_code,200)

    def test_cross_site_and_validation(self):
        res=self.client.post("/api/auth/register",headers={"Origin":"https://evil.invalid"},json={"username":"someone","password":"longpassphrase"})
        self.assertEqual(res.status_code,403)
        self.client.post("/api/auth/register",json={"username":"Organizer","password":"verystrongpassword"})
        bad=self.client.post("/api/rooms",json={"title":"Too big","min_value":0,"max_value":2000})
        self.assertEqual(bad.status_code,422)


if __name__ == "__main__":
    unittest.main()
