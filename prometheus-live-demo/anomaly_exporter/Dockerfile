FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt /app/requirements.txt
COPY requirements-postgresql.txt /app/requirements-postgresql.txt
ARG INSTALL_POSTGRESQL_SINK=false
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && if [ "$INSTALL_POSTGRESQL_SINK" = "true" ]; then pip install --no-cache-dir -r /app/requirements-postgresql.txt; fi
COPY app /app/app
COPY main.py /app/main.py
COPY rules.yml /app/rules.yml
EXPOSE 9110
CMD ["python", "/app/main.py"]
