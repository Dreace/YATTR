FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir uv

COPY requirements.txt /app/requirements.txt
RUN uv pip install --system -r requirements.txt

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
