#!/bin/bash

cd /opt/ && \
/bin/curl -L https://github.com/otter-sec/por_v2/releases/latest/download/plonky2_por-Linux-gnu-x86_64.tar.gz -o plonky2_por.tar.gz && \
/bin/tar -xzf plonky2_por.tar.gz && \
/bin/mv plonky2_por /usr/local/bin/ && \
/bin/rm plonky2_por.tar.gz
