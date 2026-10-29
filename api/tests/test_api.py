import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

from main import app


class RandlyApiTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.db = str(Path(self.folder.name) / "test.sqlite")
        import main
        main.DB_PATH = self.db
        main.COOKIE_SECURE = False
        main.RESERVATION_ADMIN_IDS = set()
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
        import main
        with main.connect() as db:
            user = db.execute("SELECT salt,password_hash FROM users WHERE username=?", ("Tester22",)).fetchone()
        self.assertEqual(len(user["salt"]), 32)
        self.assertEqual(len(user["password_hash"]), 64)
        self.assertNotEqual(user["password_hash"], "verystrongpassword")
        for attempt in range(8):
            self.assertEqual(self.client.post("/api/auth/login", json={
                "username":"Tester22", "password":"incorrect"
            }).status_code, 401, f"failed login {attempt + 1} should be allowed")
        self.assertEqual(self.client.post("/api/auth/login", json={
            "username":"Tester22", "password":"incorrect"
        }).status_code, 429)

    def test_concurrent_room_draws_are_unique_and_include_zero(self):
        self.client.post("/api/auth/register", json={"username":"ConcurrentHost", "password":"verystrongpassword"})
        room = self.client.post("/api/rooms", json={
            "title":"Concurrent 1-9", "min_value":1, "max_value":9, "no_repeats":True
        })
        self.assertEqual(room.status_code, 201, room.text)
        code = room.json()["code"]
        with ThreadPoolExecutor(max_workers=9) as pool:
            responses = list(pool.map(lambda _: self.client.post(f"/api/rooms/{code}/draw", json={}), range(9)))
        self.assertTrue(all(response.status_code == 200 for response in responses), [r.text for r in responses])
        self.assertEqual({response.json()["number"] for response in responses}, set(range(1, 10)))

        edge_room = self.client.post("/api/rooms", json={
            "title":"Negative and zero", "min_value":-1, "max_value":1, "no_repeats":True
        })
        self.assertEqual(edge_room.status_code, 201, edge_room.text)
        edge_code = edge_room.json()["code"]
        edge_numbers = [self.client.post(f"/api/rooms/{edge_code}/draw", json={}).json()["number"] for _ in range(3)]
        self.assertEqual(set(edge_numbers), {-1, 0, 1})


    def test_private_result_reservations(self):
        import main
        main.RESERVATION_ADMIN_IDS = set()
        guest = TestClient(app)
        other = TestClient(app)
        registered = self.client.post("/api/auth/register", json={
            "username": "BookingHost", "password": "long-test-password"
        })
        self.assertEqual(registered.status_code, 201)
        main.RESERVATION_ADMIN_IDS = {self.client.get("/api/auth/me").json()["id"]}
        room = self.client.post("/api/rooms", json={
            "title": "Prepared scenario", "min_value": 1,
            "max_value": 9, "no_repeats": True
        })
        self.assertEqual(room.status_code, 201, room.text)
        code = room.json()["code"]
        url = f"/api/rooms/{code}"
        endpoint = url + "/reservations"

        self.assertEqual(guest.get(endpoint).status_code, 401)
        self.assertEqual(guest.put(endpoint, json={"slot": 2, "number": 9}).status_code, 401)
        self.assertEqual(guest.request("DELETE", endpoint + "/2", json={}).status_code, 401)
        student = other.post("/api/auth/register", json={
            "username": "OtherStudent", "password": "different-test-password"
        })
        self.assertEqual(student.status_code, 201)
        self.assertEqual(other.get(endpoint).status_code, 403)
        self.assertEqual(other.put(endpoint, json={"slot": 2, "number": 9}).status_code, 403)
        self.assertEqual(other.request("DELETE", endpoint + "/2", json={}).status_code, 403)
        # A normal user owning their own room still does NOT gain booking rights.
        other_room = other.post("/api/rooms", json={
            "title": "Unprivileged room", "min_value": 1,
            "max_value": 9, "no_repeats": True
        })
        self.assertEqual(other_room.status_code, 201)
        other_code = other_room.json()["code"]
        self.assertEqual(other.get(f"/api/rooms/{other_code}/reservations").status_code, 403)
        self.assertFalse(other.get(f"/api/rooms/{other_code}").json()["can_reserve"])


        self.assertEqual(self.client.put(endpoint, json={
            "slot": 2, "number": 9, "recipient": "Максим"
        }).status_code, 200)
        self.assertEqual(self.client.put(endpoint, json={
            "slot": 4, "number": 7, "recipient": "@otherstudent"
        }).status_code, 200)
        self.assertEqual(self.client.put(endpoint, json={
            "slot": 5, "number": 8, "recipient": "@MissingUser"
        }).status_code, 422)
        self.assertEqual(self.client.put(endpoint, json={
            "slot": 5, "number": 9, "recipient": "Ирина"
        }).status_code, 409)
        self.assertEqual(self.client.put(endpoint, json={
            "slot": 3, "number": 30, "recipient": "Ирина"
        }).status_code, 422)
        self.assertEqual(self.client.put(endpoint, json={
            "slot": 20, "number": 8, "recipient": "Ирина"
        }).status_code, 422)

        admin_data = self.client.get(endpoint).json()
        self.assertEqual([(r["slot"], r["number"], r["recipient"]) for r in admin_data["reservations"]],
                         [(2, 9, "Максим"), (4, 7, "@OtherStudent")])
        public = guest.get(url).json()
        self.assertTrue(public["prepared_mode"])
        self.assertFalse(public["can_reserve"])
        self.assertTrue(self.client.get(url).json()["can_reserve"])
        self.assertNotIn("reservations", public)
        self.assertNotIn("Максим", str(public))
        self.assertNotIn("@OtherStudent", str(public))
        self.assertIsNone(public["latest"])

        first = self.client.post(url + "/draw", json={}).json()
        self.assertNotIn(first["number"], (7, 9))
        self.assertEqual(first["source"], "random")
        second = self.client.post(url + "/draw", json={}).json()
        self.assertEqual(second, {"number": 9, "source": "prepared", "recipient": "Максим"})
        public_second = guest.get(url).json()
        self.assertEqual(public_second["history"][0]["recipient"], "Максим")
        self.assertNotIn("@OtherStudent", str(public_second))
        third = self.client.post(url + "/draw", json={}).json()
        self.assertNotIn(third["number"], (7, 9, first["number"]))
        self.assertEqual(third["recipient"], "")
        fourth = self.client.post(url + "/draw", json={}).json()
        self.assertEqual(fourth, {"number": 7, "source": "prepared", "recipient": "@OtherStudent"})

        public_after = guest.get(url).json()
        self.assertEqual(public_after["latest"], 7)
        self.assertEqual(public_after["history"][0]["source"], "prepared")
        self.assertEqual(public_after["history"][1]["source"], "random")
        self.assertEqual(self.client.request("DELETE", endpoint + "/2", json={}).status_code, 409)
        self.assertEqual(self.client.put(endpoint, json={"slot": 2, "number": 8}).status_code, 409)

        # Reset restarts the prepared sequence; future bookings survive.
        self.assertEqual(self.client.post(url + "/reset", json={}).status_code, 200)
        restarted = self.client.get(endpoint).json()
        self.assertEqual(restarted["draw_count"], 0)
        self.assertFalse(restarted["reservations"][0]["revealed"])
        self.client.post(url + "/draw", json={})
        replayed = self.client.post(url + "/draw", json={}).json()
        self.assertEqual(replayed["number"], 9)
        self.assertEqual(replayed["recipient"], "Максим")

        # Reservation can be cancelled while still in the future.
        self.assertEqual(self.client.request("DELETE", endpoint + "/4", json={}).status_code, 200)
        self.assertEqual([(r["slot"], r["number"], r["recipient"]) for r in self.client.get(endpoint).json()["reservations"]],
                         [(2, 9, "Максим")])

    def test_cross_site_and_validation(self):
        res=self.client.post("/api/auth/register",headers={"Origin":"https://evil.invalid"},json={"username":"someone","password":"longpassphrase"})
        self.assertEqual(res.status_code,403)
        self.client.post("/api/auth/register",json={"username":"Organizer","password":"verystrongpassword"})
        bad=self.client.post("/api/rooms",json={"title":"Too big","min_value":0,"max_value":2000})
        self.assertEqual(bad.status_code,422)


if __name__ == "__main__":
    unittest.main()
