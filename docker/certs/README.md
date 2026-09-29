# 추가 루트 인증서 (선택)

학교·기관 네트워크가 TLS를 가로채서 Docker 빌드 중 `npm ci` 또는 Prisma 엔진 다운로드가
`self-signed certificate in certificate chain` 오류로 실패하면, 네트워크 관리자에게 받은
**루트 인증서(PEM 형식, 확장자 `.crt`)** 를 이 폴더에 넣고 다시 빌드하세요.

```powershell
docker compose build --no-cache
```

인증서가 없으면 이 폴더는 비워 두면 됩니다. `.crt` 파일은 저장소에 올라가지 않습니다.
