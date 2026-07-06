-- step382 롤백: 응답 구분 컬럼 제거 (응답 데이터가 삭제되니 주의)
alter table preorders drop column if exists response;
