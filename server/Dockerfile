FROM python:3.12-slim
RUN pip install --no-cache-dir yt-dlp
WORKDIR /app
COPY . .
ENV PORT=4173
ENV HOST=0.0.0.0
EXPOSE 4173
CMD ["python", "server/convert.py"]

