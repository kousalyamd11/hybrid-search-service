from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"welcome": "to the brand systems"}
