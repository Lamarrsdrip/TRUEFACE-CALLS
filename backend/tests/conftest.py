import base64

import mongomock
import pytest


@pytest.fixture()
def mongo_db():
    client = mongomock.MongoClient()
    return client["trueface_test"]


@pytest.fixture()
def master_key():
    return base64.b64encode(b"k" * 32).decode()
