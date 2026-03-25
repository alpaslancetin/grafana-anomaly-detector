FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app /app/app
COPY main.py /app/main.py
COPY rules.yml /app/rules.yml
EXPOSE 9110
CMD ["python", "/app/main.py"]
